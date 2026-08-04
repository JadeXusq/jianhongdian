FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared ./shared
COPY server ./server
COPY client/package.json ./client/package.json
RUN npm ci
ENV NODE_ENV=production
ENV PORT=2567
EXPOSE 2567
CMD ["npm", "run", "start", "-w", "server"]
