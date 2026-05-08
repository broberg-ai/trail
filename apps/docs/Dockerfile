FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy pre-built static site
COPY deploy/ /usr/share/nginx/html/

EXPOSE 8080
