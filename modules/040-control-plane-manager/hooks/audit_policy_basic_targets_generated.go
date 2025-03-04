// Code generated by "tools/audit_policy.go" DO NOT EDIT.
package hooks

var auditPolicyBasicNamespaces = []string{
	"d8-ceph-csi",
	"d8-cert-manager",
	"d8-chrony",
	"d8-cloud-instance-manager",
	"d8-cloud-provider-aws",
	"d8-cloud-provider-azure",
	"d8-cloud-provider-gcp",
	"d8-cloud-provider-openstack",
	"d8-cloud-provider-vsphere",
	"d8-cloud-provider-yandex",
	"d8-cni-cilium",
	"d8-cni-flannel",
	"d8-cni-simple-bridge",
	"d8-descheduler",
	"d8-flant-integration",
	"d8-ingress-nginx",
	"d8-istio",
	"d8-keepalived",
	"d8-linstor",
	"d8-local-path-provisioner",
	"d8-log-shipper",
	"d8-metallb",
	"d8-monitoring",
	"d8-network-gateway",
	"d8-okmeter",
	"d8-openvpn",
	"d8-operator-prometheus",
	"d8-pod-reloader",
	"d8-snapshot-controller",
	"d8-system",
	"d8-upmeter",
	"d8-user-authn",
	"d8-user-authz",
	"kube-system",
}
var auditPolicyBasicServiceAccounts = []string{
	"agent",
	"alliance-ingressgateway",
	"alliance-metadata-exporter",
	"annotations-converter",
	"cainjector",
	"cert-exporter",
	"cert-manager",
	"cloud-controller-manager",
	"cloud-metrics-exporter",
	"cluster-autoscaler",
	"cni-flannel",
	"cni-simple-bridge",
	"control-plane-proxy",
	"controller",
	"d8-control-plane-manager",
	"d8-kube-dns",
	"d8-kube-proxy",
	"d8-vertical-pod-autoscaler-admission-controller",
	"d8-vertical-pod-autoscaler-recommender",
	"d8-vertical-pod-autoscaler-updater",
	"dashboard",
	"deckhouse",
	"descheduler",
	"dex",
	"ebpf-exporter",
	"events-exporter",
	"extended-monitoring-exporter",
	"grafana",
	"image-availability-exporter",
	"ingress-nginx",
	"kiali",
	"kube-state-metrics",
	"legacy-cert-manager",
	"legacy-webhook",
	"linstor-controller",
	"linstor-ha-controller",
	"linstor-node",
	"linstor-pools-importer",
	"linstor-scheduler",
	"local-path-provisioner",
	"log-shipper",
	"machine-controller-manager",
	"monitoring-ping",
	"multicluster-api-proxy",
	"network-policy-engine",
	"node-exporter",
	"node-group",
	"node-local-dns",
	"node-termination-handler",
	"okmeter",
	"openvpn",
	"operator",
	"operator-prometheus",
	"piraeus-operator",
	"pod-reloader",
	"pricing",
	"prometheus",
	"relay",
	"smoke-mini",
	"snapshot-controller",
	"speaker",
	"terraform-auto-converger",
	"terraform-state-exporter",
	"trickster",
	"ui",
	"upmeter",
	"upmeter-agent",
	"webhook",
	"webhook-handler",
}
