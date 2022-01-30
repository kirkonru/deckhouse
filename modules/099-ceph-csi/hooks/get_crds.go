/*
Copyright 2021 Flant JSC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package hooks

import (
	"context"
	"fmt"

	"github.com/flant/addon-operator/pkg/module_manager/go_hook"
	"github.com/flant/addon-operator/sdk"
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/deckhouse/deckhouse/go_lib/dependency"
)

type CephCSI struct {
	APIVersion string            `json:"apiVersion"`
	Kind       string            `json:"kind"`
	Metadata   metav1.ObjectMeta `json:"metadata"`
	Spec       Spec              `json:"spec"`
}

type Spec struct {
	ClusterID string   `json:"clusterID"`
	UserID    string   `json:"userID"`
	UserKey   string   `json:"userKey"`
	Monitors  []string `json:"monitors"`
	Rbd       RBD      `json:"rbd,omitempty"`
	CephFS    CephFS   `json:"cephfs,omitempty"`
}

type RBD struct {
	StorageClasses []StorageClass `json:"storageClasses,omitempty"`
}

type CephFS struct {
	StorageClasses []StorageClass `json:"storageClasses,omitempty"`
	SubvolumeGroup string         `json:"subvolumeGroup,omitempty"`
}

type StorageClass struct {
	Name                 string   `json:"name"`
	Pool                 string   `json:"pool,omitempty"`
	ReclaimPolicy        string   `json:"reclaimPolicy,omitempty"`
	AllowVolumeExpansion bool     `json:"allowVolumeExpansion,omitempty"`
	MountOptions         []string `json:"mountOptions,omitempty"`
	DefaultFSType        string   `json:"defaultFSType,omitempty"`
	FsName               string   `json:"fsName,omitempty"`
}

type InternalValues struct {
	Name string `json:"name"`
	Spec Spec   `json:"spec"`
}

type CSIConfig struct {
	ClusterID string          `json:"clusterID"`
	Monitors  []string        `json:"monitors"`
	CephFS    CSIConfigCephFS `json:"cephFS,omitempty"`
}

type CSIConfigCephFS struct {
	SubvolumeGroup string `json:"subvolumeGroup,omitempty"`
}

var _ = sdk.RegisterFunc(&go_hook.HookConfig{
	OnBeforeHelm: &go_hook.OrderedConfig{Order: 10},
	Queue:        "/modules/ceph-csi",
	Kubernetes: []go_hook.KubernetesConfig{
		{
			Name:       "crs",
			ApiVersion: "deckhouse.io/v1alpha1",
			Kind:       "CephCSIDriver",
			FilterFunc: applyCephCSIDriverFilter,
		},
		{
			Name:       "scs",
			ApiVersion: "storage.k8s.io/v1",
			Kind:       "Storageclass",
			LabelSelector: &metav1.LabelSelector{
				MatchLabels: map[string]string{
					"app": "ceph-csi",
				},
			},
			FilterFunc: applyStorageclassFilter,
		},
	},
}, dependency.WithExternalDependencies(setInternalValues))

func applyCephCSIDriverFilter(obj *unstructured.Unstructured) (go_hook.FilterResult, error) {
	var csi = &CephCSI{}
	err := sdk.FromUnstructured(obj, csi)
	if err != nil {
		return nil, fmt.Errorf("cannot convert kubernetes object: %v", err)
	}

	return csi, nil
}

func applyStorageclassFilter(obj *unstructured.Unstructured) (go_hook.FilterResult, error) {
	var sc = &storagev1.StorageClass{}
	err := sdk.FromUnstructured(obj, sc)
	if err != nil {
		return nil, fmt.Errorf("cannot convert kubernetes object: %v", err)
	}

	return StorageClass{
		Name:                 sc.Name,
		Pool:                 sc.Parameters["pool"],
		ReclaimPolicy:        string(*sc.ReclaimPolicy),
		AllowVolumeExpansion: *sc.AllowVolumeExpansion,
		MountOptions:         sc.MountOptions,
		DefaultFSType:        sc.Parameters["csi.storage.k8s.io/fstype"],
		FsName:               sc.Parameters["fsName"],
	}, nil
}

func setInternalValues(input *go_hook.HookInput, dc dependency.Container) error {
	crs := input.Snapshots["crs"]
	scs := input.Snapshots["scs"]

	values := []InternalValues{}
	csiConfig := []CSIConfig{}

	kubeClient, err := dc.GetK8sClient()
	if err != nil {
		return err
	}

	for _, cr := range crs {
		obj := cr.(*CephCSI)

		rbdStorageClasses := obj.Spec.Rbd.StorageClasses
		if len(rbdStorageClasses) > 0 {
			for _, sc := range rbdStorageClasses {
				if isReclaimPolicyChanged(scs, sc.Name, sc.ReclaimPolicy) {
					err := kubeClient.StorageV1().StorageClasses().Delete(context.TODO(), sc.Name, metav1.DeleteOptions{})
					if err != nil {
						input.LogEntry.Error(err.Error())
					} else {
						input.LogEntry.Infof("ReclaimPolicy changed. StorageClass %s is Deleted.", sc.Name)
					}
				}
			}
		}

		cephFsStorageClasses := obj.Spec.CephFS.StorageClasses
		if len(cephFsStorageClasses) > 0 {
			for _, sc := range cephFsStorageClasses {
				if isReclaimPolicyChanged(scs, sc.Name, sc.ReclaimPolicy) {
					err := kubeClient.StorageV1().StorageClasses().Delete(context.TODO(), sc.Name, metav1.DeleteOptions{})
					if err != nil {
						input.LogEntry.Error(err.Error())
					} else {
						input.LogEntry.Infof("ReclaimPolicy changed. StorageClass %s is Deleted.", sc.Name)
					}
				}
			}
		}

		values = append(values, InternalValues{Name: obj.Metadata.Name, Spec: obj.Spec})
		csiConfig = append(csiConfig, CSIConfig{ClusterID: obj.Spec.ClusterID, Monitors: obj.Spec.Monitors, CephFS: CSIConfigCephFS{SubvolumeGroup: obj.Spec.CephFS.SubvolumeGroup}})
	}

	input.Values.Set("cephCsi.internal.crs", values)
	input.Values.Set("cephCsi.internal.csiConfig", csiConfig)

	return nil
}

func isReclaimPolicyChanged(storageClasses []go_hook.FilterResult, scName, scReclaimPolicy string) bool {
	for _, storageClass := range storageClasses {
		sc := storageClass.(storagev1.StorageClass)
		if sc.Name == scName {
			if string(*sc.ReclaimPolicy) != scReclaimPolicy {
				return true
			}
		}
	}
	return false
}
