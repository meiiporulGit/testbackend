import { Schema } from "mongoose";
import db from "../../core/mongodb/mongo-connection.js";
var schema = Schema;

const cashpriceschema = new schema(
  {    
    serviceCode: { type: String },
    serviceName:  { type: String },
    hospitalID: { type: String },
    cashPrice: { type: String },
    NPI: { type: String },
  },
  {
    versionKey: false,
    strict: true,
    collection: "Cashprice",
  }
);

var Cashprice = db.model("Cashprice", cashpriceschema);

export default Cashprice;