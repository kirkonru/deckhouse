bb-deckhouse-get-disruptive-update-approval() {
    if [ "$FIRST_BASHIBLE_RUN" == "yes" ]; then
        return 0
    fi

    bb-log-info "Disruption required, asking for approval"

    bb-log-info "Annotating Node with annotation 'update.node.deckhouse.io/disruption-required='."
    attempt=0
    until
        node_data="$(
          kubectl --kubeconfig=/etc/kubernetes/kubelet.conf get node "$(hostname -s)" -o json | jq '
          {
            "resourceVersion": .metadata.resourceVersion,
            "isDisruptionApproved": (.metadata.annotations | has("update.node.deckhouse.io/disruption-approved")),
            "isDisruptionRequired": (.metadata.annotations | has("update.node.deckhouse.io/disruption-required"))
          }
        ')" &&
         jq -ne --argjson n "$node_data" '(($n.isDisruptionApproved | not) and ($n.isDisruptionRequired)) or ($n.isDisruptionApproved)' >/dev/null
    do
        attempt=$(( attempt + 1 ))
        if [ -n "${MAX_RETRIES-}" ] && [ "$attempt" -gt "${MAX_RETRIES}" ]; then
            bb-log-error "ERROR: Failed to annotate Node with annotation 'update.node.deckhouse.io/disruption-required='."
            exit 1
        fi
        kubectl \
          --kubeconfig=/etc/kubernetes/kubelet.conf \
          --resource-version="$(jq -nr --argjson n "$node_data" '$n.resourceVersion')" \
          annotate node "$(hostname -s)" update.node.deckhouse.io/disruption-required= || { bb-log-info "Retry setting update.node.deckhouse.io/disruption-required= annotation on Node in 10 sec..."; sleep 10; }
    done

    bb-log-info "Disruption required, waiting for approval"

    attempt=0
    until
      kubectl --kubeconfig=/etc/kubernetes/kubelet.conf get node "$(hostname -s)" -o json | \
      jq -e '.metadata.annotations | has("update.node.deckhouse.io/disruption-approved")' >/dev/null
    do
        attempt=$(( attempt + 1 ))
        if [ -n "${MAX_RETRIES-}" ] && [ "$attempt" -gt "${MAX_RETRIES}" ]; then
            bb-log-error "ERROR: Failed to get annotation 'update.node.deckhouse.io/disruption-approved' from Node."
            exit 1
        fi
        bb-log-info "Step needs to make some disruptive action. It will continue upon approval:"
        bb-log-info "kubectl annotate node $(hostname -s) update.node.deckhouse.io/disruption-approved="
        bb-log-info "Retry in 10sec..."
        sleep 10
    done

    bb-log-info "Disruption approved!"
}
