ARG BASE_ALPINE
ARG BASE_GOLANG_17_ALPINE

FROM $BASE_GOLANG_17_ALPINE AS build
WORKDIR /app
COPY easyrsa-migrator.go /app
COPY go.mod /app
COPY go.sum /app
RUN go build .

FROM $BASE_ALPINE
WORKDIR /app
RUN apk update && apk add bash openssl openvpn
COPY --from=build /app/easyrsa-migrator /app/
ENV LANG=C.UTF-8
