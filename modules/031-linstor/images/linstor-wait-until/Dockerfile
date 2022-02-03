ARG BASE_DEBIAN
ARG BASE_GOLANG_17_BUSTER

FROM $BASE_GOLANG_17_BUSTER as builder
ARG LINSTOR_WAIT_UNTIL_VERSION=0.1.1

RUN git clone https://github.com/LINBIT/linstor-wait-until /usr/local/go/linstor-wait-until \
 && cd /usr/local/go/linstor-wait-until \
 && git reset --hard v${LINSTOR_WAIT_UNTIL_VERSION} \
 && make -f container.mk staticrelease \
 && mv ./linstor-wait-until /

FROM $BASE_DEBIAN
COPY --from=builder /linstor-wait-until /usr/bin/linstor-wait-until
ENTRYPOINT ["/usr/bin/linstor-wait-until"]
