FROM nginx:alpine

RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Pre-built widget bundle + version directory + landing page
COPY dist/ /usr/share/nginx/html/v1/
COPY public/ /usr/share/nginx/html/

EXPOSE 8080
