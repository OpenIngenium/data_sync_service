# Use the official Node.js slim image as the base image
FROM node:24.22.1-slim

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the container
COPY package*.json ./

# Install production dependencies only (exclude devDependencies)
RUN npm ci --omit=dev

# Copy the rest of the application code into the container
COPY . .

# Start the application
CMD ["npm", "start"]
