const express = require('express');
const app = express();

app.use(express.json());

app.post('/helius', (req, res) => {
    console.log("Webhook received");
    res.status(200).send('OK');
});

app.listen(3000, () => {
    console.log('Server listening on port 3000');
});


