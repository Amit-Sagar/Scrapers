const { Client } = require('@elastic/elasticsearch');
const fs = require('fs');
const path = require('path');

const caCertPath = './certs/http_ca.crt';

const client = new Client({
    node: 'https://localhost:9200',
    auth: {
        username: 'elastic',
        password: 'wjAq_zeRg5FzjZWt_tZ0'
    },
    tls: {
        ca: fs.readFileSync(caCertPath),
        rejectUnauthorized: false,
    },
    maxRetries: 5,
    requestTimeout: 60000,
});

module.exports = client;
