# The members' room's model on Vertex AI (design §5.10; infra/terraform README "Members' room model"): Ollama, plus
# rclone to copy the models from the project's bucket when a machine starts, since Vertex AI mounts no bucket for a
# model's container. Built once per Ollama version with Cloud Build into the project's ustpvote repository.
ARG OLLAMA_VERSION=0.40.5
ARG RCLONE_VERSION=1.75.2

FROM rclone/rclone:${RCLONE_VERSION} AS rclone

FROM ollama/ollama:${OLLAMA_VERSION}
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
COPY start.sh /start.sh
ENV OLLAMA_MODELS=/models
EXPOSE 8080
ENTRYPOINT ["/bin/sh", "/start.sh"]
