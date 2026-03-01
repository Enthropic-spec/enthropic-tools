# Build stage
FROM rust:1-alpine AS builder
WORKDIR /build
RUN apk add --no-cache musl-dev
COPY . .
RUN cargo build --release

# Runtime stage — minimal image
FROM alpine:3
RUN apk add --no-cache ca-certificates
COPY --from=builder /build/target/release/enthropic /usr/local/bin/enthropic

# Project files are mounted here at runtime
WORKDIR /project

# Default: MCP server over stdio
ENTRYPOINT ["enthropic", "serve"]
