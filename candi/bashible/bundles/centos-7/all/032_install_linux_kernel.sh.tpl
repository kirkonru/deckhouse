{{- if ne .runType "ImageBuilding" }}
bb-event-on 'bb-package-installed' 'post-install'
post-install() {
  bb-flag-set reboot
}
{{- end }}

desired_version="3.10.0-1127.8.2.el7.x86_64"

if ! bb-yum-package? "kernel-${desired_version}"; then
  bb-deckhouse-get-disruptive-update-approval
  bb-yum-install "kernel-${desired_version}"
fi

packages="$(rpm -q kernel | grep -Ev "^kernel-${desired_version}$")"
if [ -n "$packages" ]; then
  bb-yum-remove $packages
fi
