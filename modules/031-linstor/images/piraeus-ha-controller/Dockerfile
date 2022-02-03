ARG BASE_DEBIAN
ARG BASE_GOLANG_17_BUSTER

FROM $BASE_GOLANG_17_BUSTER as builder
ARG PIRAEUS_HA_CONTROLLER_VERSION=0.2.0

RUN git clone https://github.com/piraeusdatastore/piraeus-ha-controller /usr/local/go/piraeus-ha-controller \
 && cd /usr/local/go/piraeus-ha-controller \
 && git reset --hard v${PIRAEUS_HA_CONTROLLER_VERSION} \
 && cd cmd/piraeus-ha-controller \
 && go build \
 && mv ./piraeus-ha-controller /

FROM $BASE_DEBIAN
COPY --from=builder /piraeus-ha-controller /usr/bin/piraeus-ha-controller
ENTRYPOINT ["/usr/bin/piraeus-ha-controller"]
