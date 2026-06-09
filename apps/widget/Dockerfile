FROM nginx:alpine

# F196 — curl for the on-boot deploy self-report (/docker-entrypoint.d).
RUN apk add --no-cache curl

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Pre-built widget bundle + version directory + landing page
COPY dist/ /usr/share/nginx/html/v1/
COPY public/ /usr/share/nginx/html/

# F196 — self-report this deploy to upmetrics on boot. nginx:alpine runs
# /docker-entrypoint.d/*.sh before starting nginx. GIT_SHA baked via build-arg.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
COPY report-deploy.sh /docker-entrypoint.d/99-report-deploy.sh
RUN chmod +x /docker-entrypoint.d/99-report-deploy.sh

EXPOSE 8080
