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
	"fmt"

	"github.com/flant/addon-operator/pkg/module_manager/go_hook"
	"github.com/flant/addon-operator/sdk"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
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
	StorageClasses []StorageClasses `json:"storageClasses,omitempty"`
}

type CephFS struct {
	StorageClasses []StorageClasses `json:"storageClasses,omitempty"`
	SubvolumeGroup string           `json:"subvolumeGroup,omitempty"`
}

type StorageClasses struct {
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
			Kind:       "CephCSI",
			FilterFunc: applyFilter,
		},
	},
}, setInternalValues)

func applyFilter(obj *unstructured.Unstructured) (go_hook.FilterResult, error) {
	var csi = &CephCSI{}
	err := sdk.FromUnstructured(obj, csi)
	if err != nil {
		return nil, fmt.Errorf("cannot convert kubernetes object: %v", err)
	}

	return csi, nil
}

func setInternalValues(input *go_hook.HookInput) error {
	crs := input.Snapshots["crs"]

	values := []InternalValues{}
	csiConfig := []CSIConfig{}

	for _, cr := range crs {
		obj := cr.(*CephCSI)
		values = append(values, InternalValues{Name: obj.Metadata.Name, Spec: obj.Spec})
		csiConfig = append(csiConfig, CSIConfig{ClusterID: obj.Spec.ClusterID, Monitors: obj.Spec.Monitors, CephFS: CSIConfigCephFS{SubvolumeGroup: obj.Spec.CephFS.SubvolumeGroup}})
	}

	input.Values.Set("cephCsi.internal.crs", values)
	input.Values.Set("cephCsi.internal.csiConfig", csiConfig)

	return nil
}
