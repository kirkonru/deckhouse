ARG BASE_DEBIAN
ARG BASE_GOLANG_17_BUSTER

FROM $BASE_GOLANG_17_BUSTER as builder
ARG STORK_VERSION=2.8.2

RUN git clone https://github.com/libopenstorage/stork /usr/local/go/stork \
 && cd /usr/local/go/stork \
 && git reset --hard v${STORK_VERSION}

WORKDIR /usr/local/go/stork

# Do not create directory if not found (GH: #224)
COPY patches/update-golinstor.patch /
RUN git apply /update-golinstor.patch
RUN make vendor

RUN make stork storkctl \
 && mv bin/stork bin/linux/storkctl /

FROM $BASE_DEBIAN
COPY --from=builder /stork /storkctl /
ENTRYPOINT ["/stork"]
