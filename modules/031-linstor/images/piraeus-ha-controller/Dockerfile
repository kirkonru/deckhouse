ARG BASE_DEBIAN
ARG BASE_GOLANG_17_BUSTER
ARG PIRAEUS_HA_CONTROLLER_VERSION=0.2.0

FROM $BASE_GOLANG_17_BUSTER as builder

RUN git clone https://github.com/piraeusdatastore/piraeus-ha-controller /usr/local/go/piraeus-ha-controller \
 && cd /usr/local/go/piraeus-ha-controller \
 && git reset --hard v${PIRAEUS_HA_CONTROLLER_VERSION} \
 && cd cmd/piraeus-ha-controller \
 && go build \
 && mv ./piraeus-ha-controller /

FROM debian:buster
COPY --from=builder /piraeus-ha-controller /piraeus-ha-controller
ENTRYPOINT ["/piraeus-ha-controller"]
