# Deliberately broken API image for the rollback drill: starts, never gets
# Ready (exits before listening). Tagged as if it were a normal release.
ARG BASE
FROM ${BASE}
CMD ["node", "-e", "console.error('boot: missing config, exiting'); process.exit(1)"]
