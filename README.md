# ArangoDB to Elasticsearch Synchronizer 

A simple script to incrementally transfer data from ArangoDB to Elasticsearch, keeping the Elasticsearch index up-to-date with changes in the ArangoDB collections.

## Features 

- Transfers data incrementally, ensuring that the Elasticsearch index is kept up-to-date with the latest changes in ArangoDB
- Pre-processes documents before indexing them in Elasticsearch to set default values, remove unnecessary fields, and format data correctly
- Automatically retries the transfer in case of errors
- Logs important information and errors during the data transfer process

## Prerequisites

- Node.js (version 14.0 or higher)
- An ArangoDB instance
- An Elasticsearch instance
 
## Installation

1. Clone the repository:

2. Change to the project directory and install the required dependencies:

npm install

## Configuration 

1. Update the `config.js` file with the necessary configuration for your ArangoDB and Elasticsearch instances:

```javascript
    ARANGO_URL: process.env.ARANGO_URL || 'http://localhost:8529',
    ARANGO_USER: process.env.ARANGO_USER || 'user',
    ARANGO_PASSWORD: process.env.ARANGO_ROOT_PASSWORD || 'password',
    ARANGO_DB_NAME: process.env.ARANGO_DB_NAME || 'dbname',
    ES_HOST: process.env.ES_HOST || '127.0.0.1',
    ES_PORT: process.env.ES_PORT || 9200,
```
Adjust the sleep() interval in index.js according to your needs:
```javascript
await sleep(60000); // Adjust this interval according to your needs
```

Usage
Run the script: 

```
node index.js
```

The script will start synchronizing data from ArangoDB to Elasticsearch and log the progress. The synchronization process will run indefinitely, and the script will periodically check for new or updated documents in ArangoDB to transfer to Elasticsearch.

