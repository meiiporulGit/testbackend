//Import the mongoose module
import mongodb from 'mongoose';
import dotenv from 'dotenv';

// Configure env file
dotenv.config();

mongodb.connect(process.env.MONGO_URI, {useNewUrlParser: true, useUnifiedTopology: true, autoIndex: true});

//Get the default connection
var db = mongodb.connection;

//Bind connection to error event (to get notification of connection errors)
db.on('error',function(){ console.error("MongoDb connection failure")});

export default db;