# Build stage
FROM rust:1-alpine@sha256:2249050332b405613b17fa96bef438b9b92569d76b3e1f64cbb7fb603abb713d AS builder
WORKDIR /build
RUN apk add --no-cache musl-dev
COPY . .
RUN CARGO_NET_GIT_FETCH_WITH_CLI=true cargo build --release

# Runtime stage — minimal image
FROM alpine:3@sha256:59855d3dceb3ae53991193bd03301e082b2a7faa56a514b03527ae0ec2ce3a95
RUN apk add --no-cache ca-certificates
COPY --from=builder /build/target/release/enthropic /usr/local/bin/enthropic

# Project files are mounted here at runtime
WORKDIR /project

# Default: MCP server over stdio
ENTRYPOINT ["enthropic", "serve"]
