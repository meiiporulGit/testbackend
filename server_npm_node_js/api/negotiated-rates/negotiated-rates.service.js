import { NegotiatedRates } from "./negotiated-rates.schema.js";

export async function getNegotiatedRatesByCodeAndNPI(billingCode, facilityNPI, serviceCode, insuranceProvider) {
  const NegotiatedPrices = await NegotiatedRates.aggregate(
      [
        {
            '$unwind': {
                'path': '$negotiated_rates', 
                'preserveNullAndEmptyArrays': true
            }
        }, {
            '$unwind': {
                'path': '$negotiated_rates.negotiated_prices', 
                'preserveNullAndEmptyArrays': true
            }
        }, {
            '$unwind': {
                'path': '$negotiated_rates.negotiated_prices.service_code', 
                'preserveNullAndEmptyArrays': true
            }
        }, {
            '$unwind': {
                'path': '$negotiated_rates.provider_groups', 
                'preserveNullAndEmptyArrays': true
            }
        }, {
            '$unwind': {
                'path': '$negotiated_rates.provider_groups.npi', 
                'preserveNullAndEmptyArrays': true
            }
        }, {
            '$match': {
                'billing_code': billingCode, 
                'negotiated_rates.negotiated_prices.service_code': serviceCode,
                "insuranceProviderID": insuranceProvider, 
                '$expr': {
                    '$eq': [
                        {
                            '$toString': '$negotiated_rates.provider_groups.npi'
                        }, facilityNPI
                    ]
                }
            }
        }
    ]
    );
    return NegotiatedPrices;
}