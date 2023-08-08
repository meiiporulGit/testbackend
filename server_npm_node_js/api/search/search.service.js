import { Client } from '@elastic/elasticsearch';
import dotenv from 'dotenv';
import { Facility } from '../facility/facility.schema.js';
import { Lookup } from '../facility/facility.schema.js';
import Pricelist from '../services/pricelist.schema.js';
import Cashprice from './cash_price.schema.js';
import CityStateZipcode from '../organization/lookup.schema.js';
import { getNegotiatedRatesByCodeAndNPI } from '../negotiated-rates/negotiated-rates.service.js';

dotenv.config()

const client = new Client({ node: `http://${process.env.ELASTIC_HOST}:${process.env.ELASTIC_PORT}` });

export default {
  search,
  negotiatedSearch,
  serviceNameSearch,
  serviceLocationSearch

}

// function calcDistance(lat1, lon1, lat2, lon2) {
//   var R = 6371; // km (change this constant to get miles)
//   var dLat = (lat2 - lat1) * Math.PI / 180;
//   var dLon = (lon2 - lon1) * Math.PI / 180;
//   var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
//     Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
//     Math.sin(dLon / 2) * Math.sin(dLon / 2);
//   var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
//   var d = R * c;
//   return d * 1000;
// }

async function search(body) {

  const q = body.q ?? "";
  const location = body.location;
  var lat = body.lat;
  var lon = body.lon;
  const distance = body.distance ?? '30mi';
  const facilityType = body.facilityType;
  const ratingRange = body.ratingRange;
  const range = body.range;
  console.log(body, 'body')

  try {
    var facility_query = [];
    var facility_filter = [];
    if (location != null) {
      facility_query.push(
        {
          multi_match: {
            query: location,
            fields: ["addressLine1", "addressLine2", "city", "state", "zipCode"]
          }
        }
      );
      if (!isNaN(parseInt(location))) {
        const result = await client.search(
          {
            index: "hltest.citystatezipcode",
            query: {
              bool: {
                must: {
                  term: {
                    "ZIP_CODE": {
                      value: location,
                    }
                  }
                }
              }
            }
          }
        )
        if (result.hits.hits.length > 0) {
          lat = +result.hits.hits[0]._source["LAT"] ?? 0;
          lon = +result.hits.hits[0]._source["LONG"] ?? 0;

          facility_filter.push(
            {
              geo_distance: {
                distance: distance,
                location: {
                  lat: +result.hits.hits[0]._source["LAT"] ?? 0,
                  lon: +result.hits.hits[0]._source["LONG"] ?? 0,
                }
              }
            }
          )
        }
      }
    } else {
      if (lat != null || lon != null) {
        facility_filter.push(
          {
            geo_distance: {
              distance: distance,
              location: {
                lat: lat ?? 0,
                lon: lon ?? 0,
              }
            }
          }
        )
      }
    }

    var result = await client.search(
      {
        index: "hltest.lookup",
        from: 0, size: 1000,
        runtime_mappings: {
          location: {
            type: "geo_point",
            script: `
                            double lat = 0.0;
                            double lon = 0.0;
                           
                            if(doc.containsKey('latitude.keyword') && doc['latitude.keyword'].size() != 0){
                                lat = Double.parseDouble(doc['latitude.keyword'].value);
                            } 
                            if(doc.containsKey('longitude.keyword')  && doc['longitude.keyword'].size() != 0) {
                                lon = Double.parseDouble(doc['longitude.keyword'].value);
                            }
                    
                            emit(lat,lon);
                        `

          }
        },
        query: {
          bool: {
            should: facility_query,
            filter: facility_filter,
          }
        },
        _source: [
          "facilityNPI"
        ]
      }
    );
    var services = [];
    if (location == null && lat == null && lon == null) {
      var result = await client.search(
        {
          from: 0, size: 1000,
          index: "hltest.pricelist",
          query: {
            bool: {
              should: [
                {
                  match: {
                    "DiagnosisTestorServiceName": {
                      query: q,
                      operator: "and"
                    }
                  }
                }
              ]
            }
          }
        }
      )
    }

    var facilityNPIList = result.hits.hits.map((value) => value._source.facilityNPI);

    var query = [
      {
        terms: {
          "FacilityNPI": facilityNPIList,
        }
      }
    ];
    if (q.trim() !== '') {
      query.push(
        {
          match: {
            "DiagnosisTestorServiceName": {
              query: q,
              operator: "and"
            }
          }
        },
      )
    }
    var result = await client.search(
      {
        from: 0, size: 1000,
        index: "hltest.pricelist",
        query: {
          bool: {
            must: query
          }
        },
        _source: false
      }
    )
    var serviceIDList = result.hits.hits.map((value) => value._id);

    var serviceMatchQuary = {
      distance: {
        $gte: 0,
        $lte: 100,
      },


    };
    if (facilityType != null) {
      serviceMatchQuary['facilityDetails.facilityType.MainfacilityType'] = facilityType;
    }
    

    if (ratingRange != null) {
      serviceMatchQuary['facilityDetails.rating'] = {
        $gte: ratingRange[0],
        $lte: ratingRange[1],
      }
    }
    else if (ratingRange != null) {
      serviceMatchQuary['facilityDetails.rating'] =
      {
        $eq: null
      }
    };

    if (range != null) {
      serviceMatchQuary['$expr'] = {
        $and: [
          {
            $gte: [
              {
                $toDouble: "$FacilityPrices"
              },
              range[0]
            ]
          },
          {
            $lte: [
              {
                $toDouble: "$FacilityPrices"
              },
              range[1]
            ]
          },
        ],
      }
    }
    var serviceList = await Pricelist.aggregate(
      [
        {
          '$match': {
            '$expr': {
              '$in': [
                {
                  '$toString': '$_id'
                }, serviceIDList
              ]
            }
          }
        }, {
          '$lookup': {
            'from': 'Facility',
            'let': {
              'facilityNPI': '$FacilityNPI'
            },
            'pipeline': [
              {
                '$match': {
                  '$expr': {
                    '$eq': [
                      '$facilityNPI', '$$facilityNPI'
                    ]
                  }
                }
              }, {
                '$lookup': {
                  'from': 'Lookup',
                  'let': {
                    'facilityNPI': '$facilityNPI'
                  },
                  'pipeline': [
                    {
                      '$match': {
                        '$expr': {
                          '$eq': [
                            '$facilityNPI', '$$facilityNPI'
                          ]
                        }
                      }
                    }, {
                      '$project': {
                        '_id': 0,
                        'rating': 1
                      }
                    }
                  ],
                  'as': 'rating'
                }
              }, {
                '$unwind': {
                  'path': '$rating',
                  'preserveNullAndEmptyArrays': true
                }
              }, {
                '$project': {
                  '_id': 0,
                  'facilityID': 1,
                  'facilityNPI': 1,
                  'facilityName': 1,
                  'facilityNPI': 1,
                  'facilityType': 1,
                  'providerID': 1,
                  'address': 1,
                  'GPSCoordinate': 1,
                  'email': 1,
                  'contact': 1,
                  'rating': {
                    '$toInt': '$rating.rating'
                  }
                }
              }
            ],
            'as': 'facilityDetails'
          }
        }, {
          '$unwind': {
            'path': '$facilityDetails',
            'preserveNullAndEmptyArrays': true
          }
        }, {
          '$addFields': {
            'r': 6371,
            'pibyeighty': {
              '$divide': [
                3.14159265359, 180
              ]
            }
          }
        }, {
          '$addFields': {
            'dlat': {
              '$multiply': [
                {
                  '$subtract': [
                    {
                      '$convert': {
                        'input': '$facilityDetails.GPSCoordinate.latitude',
                        'to': 'double'
                      }
                    }, {
                      '$convert': {
                        'input': lat,
                        'to': 'double'
                      }
                    }
                  ]
                }, '$pibyeighty'
              ]
            },
            'dlong': {
              '$multiply': [
                {
                  '$subtract': [
                    {
                      '$convert': {
                        'input': '$facilityDetails.GPSCoordinate.longitude',
                        'to': 'double'
                      }
                    }, {
                      '$convert': {
                        'input': lon,
                        'to': 'double'
                      }
                    }
                  ]
                }, '$pibyeighty'
              ]
            }
          }
        }, {
          '$addFields': {
            'a': {
              '$add': [
                {
                  '$multiply': [
                    {
                      '$sin': {
                        '$divide': [
                          '$dlat', 2
                        ]
                      }
                    }, {
                      '$sin': {
                        '$divide': [
                          '$dlat', 2
                        ]
                      }
                    }
                  ]
                }, {
                  '$multiply': [
                    {
                      '$cos': {
                        '$multiply': [
                          {
                            '$convert': {
                              'input': lat,
                              'to': 'double'
                            }
                          }, '$pibyeighty'
                        ]
                      }
                    }, {
                      '$cos': {
                        '$multiply': [
                          {
                            '$convert': {
                              'input': '$facilityDetails.GPSCoordinate.latitude',
                              'to': 'double'
                            }
                          }, '$pibyeighty'
                        ]
                      }
                    }, {
                      '$sin': {
                        '$divide': [
                          '$dlong', 2
                        ]
                      }
                    }, {
                      '$sin': {
                        '$divide': [
                          '$dlong', 2
                        ]
                      }
                    }
                  ]
                }
              ]
            }
          }
        }, {
          '$addFields': {
            'distance': {
              '$multiply': [
                {
                  '$multiply': [
                    {
                      '$multiply': [
                        6371, {
                          '$multiply': [
                            2, {
                              '$atan2': [
                                {
                                  '$sqrt': '$a'
                                }, {
                                  '$sqrt': {
                                    '$subtract': [
                                      1, '$a'
                                    ]
                                  }
                                }
                              ]
                            }
                          ]
                        }
                      ]
                    }, 1000
                  ]
                }, 0.000621371
              ]
            }
          }
        },
        {
          '$match': serviceMatchQuary,
        },
        {
          '$project': {
            '_id': 0,
            'SNo': 1,
            'ServiceCode': 1,
            'DiagnosisTestorServiceName': 1,
            'Organisationid': 1,
            'OrganisationPrices': 1,
            'FacilityNPI': 1,
            'FacilityName': 1,
            'FacilityPrices':  {
              $convert: {
                input: '$FacilityPrices',
                to: "double",
              }},
              'price':'$FacilityPrices',
            'facilityDetails': 1,
            'distance': {
              '$round': [
                '$distance', 2
              ]
            },
            'priceType': 'facilityPrice',
            'createdDate': 1,
            'updatedDate': 1,
            'createdBy': 1,
            'updatedBy': 1
          }
        },
        {
          '$sort': {
            'distance': 1
          }
        }
      ]
    );

    services.push(...serviceList);
    var queryCash = [
      {
        terms: {
          "NPI": facilityNPIList,
        }
      }
    ];

    if (q.trim() !== '') {
      queryCash.push(
        {
          match: {
            "serviceName": {
              query: q,
              operator: "and"
            }

          }
        },
      )
    }
    if (facilityType == null || facilityType == "FACT-5") {
      var result = await client.search(
        {
          from: 0, size: 1000,
          index: "hltest.cashprice",
          query: {
            bool: {
              must: queryCash
            }
          },
          _source: false
        }
      )
      var cashpriceserviceIDList = result.hits.hits.map((value) => value._id);

      var serviceMatchQuary = {
        distance: {
          $gte: 0,
          $lte: 100,
        },

      };

      if (ratingRange != null) {
        serviceMatchQuary['facilityDetails.rating'] = {
          $gte: ratingRange[0],
          $lte: ratingRange[1],
        }
      }
      else if (ratingRange != null) {
        serviceMatchQuary['facilityDetails.rating'] = {
          $eq: null
        }
      }    

      if (range != null) {
        serviceMatchQuary['$expr'] = {
          $and: [
            {
              $gte: [
                {
                  $toDouble: "$cashPrice"
                },
                range[0]
              ]
            },
            {
              $lte: [
                {
                  $toDouble: "$cashPrice"
                },
                range[1]
              ]
            },
          ],
        }
      }
      var cashPriceserviceList = await Cashprice.aggregate(
        [
          {
            $match: {
              $expr: {
                $in: [
                  {
                    $toString: "$_id",
                  },
                  cashpriceserviceIDList
                ],
              },
            },
          },
          {
            $lookup: {
              from: "Lookup",
              let: {
                facilityNPI: "$NPI",
              },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: [
                        "$facilityNPI",
                        "$$facilityNPI",
                      ],
                    },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    facilityNPI: 1,
                    facilityName: 1,
                    addressLine1: 1,
                    city: 1,
                    state: 1,
                    zipCode: 1,
                    latitude: 1,
                    longitude: 1,
                    rating: {
                      $toInt: "$rating",
                    },
                  },
                },
              ],
              as: "facilityDetails",
            },
          },
          {
            $unwind: {
              path: "$facilityDetails",
              preserveNullAndEmptyArrays: true,
            },
          },
          {
            $addFields: {
              r: 6371,
              pibyeighty: {
                $divide: [3.14159265359, 180],
              },
            },
          },
          {
            $addFields: {
              dlat: {
                $multiply: [
                  {
                    $subtract: [
                      {
                        $convert: {
                          input:
                            "$facilityDetails.latitude",
                          to: "double",
                        },
                      },
                      {
                        $convert: {
                          input: lat,
                          to: "double",
                        },
                      },
                    ],
                  },
                  "$pibyeighty",
                ],
              },
              dlong: {
                $multiply: [
                  {
                    $subtract: [
                      {
                        $convert: {
                          input:
                            "$facilityDetails.longitude",
                          to: "double",
                        },
                      },
                      {
                        $convert: {
                          input: lon,
                          to: "double",
                        },
                      },
                    ],
                  },
                  "$pibyeighty",
                ],
              },
            },
          },
          {
            $addFields: {
              a: {
                $add: [
                  {
                    $multiply: [
                      {
                        $sin: {
                          $divide: ["$dlat", 2],
                        },
                      },
                      {
                        $sin: {
                          $divide: ["$dlat", 2],
                        },
                      },
                    ],
                  },
                  {
                    $multiply: [
                      {
                        $cos: {
                          $multiply: [
                            {
                              $convert: {
                                input: lat,
                                to: "double",
                              },
                            },
                            "$pibyeighty",
                          ],
                        },
                      },
                      {
                        $cos: {
                          $multiply: [
                            {
                              $convert: {
                                input:
                                  "$facilityDetails.latitude",
                                to: "double",
                              },
                            },
                            "$pibyeighty",
                          ],
                        },
                      },
                      {
                        $sin: {
                          $divide: ["$dlong", 2],
                        },
                      },
                      {
                        $sin: {
                          $divide: ["$dlong", 2],
                        },
                      },
                    ],
                  },
                ],
              },
            },
          },
          {
            $addFields: {
              distance: {
                $multiply: [
                  {
                    $multiply: [
                      {
                        $multiply: [
                          6371,
                          {
                            $multiply: [
                              2,
                              {
                                $atan2: [
                                  {
                                    $sqrt: "$a",
                                  },
                                  {
                                    $sqrt: {
                                      $subtract: [
                                        1,
                                        "$a",
                                      ],
                                    },
                                  },
                                ],
                              },
                            ],
                          },
                        ],
                      },
                      1000,
                    ],
                  },
                  0.000621371,
                ],
              },
            },
          },
          {
            $match: serviceMatchQuary,
          },
          {
            $project: {
              _id: 0,
              serviceCode: 1,
              serviceName: 1,
              hospitalID: 1,
              cashPrice: {
                $convert: {
                  input: '$cashPrice',
                  to: "double",
                },
                
              },
              price:'$cashPrice',
              NPI: 1,
              facilityDetails: 1,
              distance: {
                $round: ["$distance", 2],
              },
              priceType: "cashPrice",
              createdDate: 1,
              updatedDate: 1,
              createdBy: 1,
              updatedBy: 1,
            },
          },
          {
            $sort: {
              distance: 1,
            },
          },
        ]
      );

      services.push(...cashPriceserviceList);
    }


    var sortServicesbydistance = services.sort((a, b) => {
      return a.distance - b.distance;
    });

    return { data: sortServicesbydistance }
  } catch (e) {
    console.log(e)
    throw Error(e)
  }
}

async function negotiatedSearch(body) {
  const q = body.q ?? "";
  const location = body.location;
  var lat = body.lat;
  var lon = body.lon;
  const distance = body.distance ?? '30mi';
  const facilityType = body.facilityType;
  const serviceCode = body.serviceCode != null ? +body.serviceCode : 21;
  const insuranceProvider = body.insuranceProvider != null ? body.insuranceProvider : "INSP-1";
  const negotiatedRates = body.negotiatedRates;
  console.log(body, 'body')
  try {
    var facility_query = [];
    var facility_filter = [];
    if (location != null) {
      facility_query.push(
        {
          multi_match: {
            query: location,
            fields: ["addressLine1", "addressLine2", "city", "state", "zipCode"]
          }
        }
      );
      if (!isNaN(parseInt(location))) {
        const result = await client.search(
          {
            index: "hltest.citystatezipcode",
            query: {
              bool: {
                must: {
                  term: {
                    "ZIP_CODE": {
                      value: location,
                    }
                  }
                }
              }
            }
          }
        )
        if (result.hits.hits.length > 0) {
          lat = +result.hits.hits[0]._source["LAT"] ?? 0;
          lon = +result.hits.hits[0]._source["LONG"] ?? 0;
          facility_filter.push(
            {
              geo_distance: {
                distance: distance,
                location: {
                  lat: +result.hits.hits[0]._source["LAT"] ?? 0,
                  lon: +result.hits.hits[0]._source["LONG"] ?? 0,
                }
              }
            }
          )
        }
      }
    } else {
      if (lat != null || lon != null) {
        facility_filter.push(
          {
            geo_distance: {
              distance: distance,
              location: {
                lat: lat ?? 0,
                lon: lon ?? 0,
              }
            }
          }
        )
      }
    }
    var result = await client.search(
      {
        index: "hltest.facility",
        from: 0, size: 1000,
        runtime_mappings: {
          location: {
            type: "geo_point",
            script: `
                            double lat = 0.0;
                            double lon = 0.0;
                            if(doc.containsKey('GPSCoordinate.latitude.keyword') && doc['GPSCoordinate.latitude.keyword'].size() != 0){
                                lat = Double.parseDouble(doc['GPSCoordinate.latitude.keyword'].value);
                            } 
                            if(doc.containsKey('GPSCoordinate.longitude.keyword')  && doc['GPSCoordinate.longitude.keyword'].size() != 0) {
                                lon = Double.parseDouble(doc['GPSCoordinate.longitude.keyword'].value);
                            }
                    
                            emit(lat,lon);
                        `

          }
        },
        query: {
          bool: {
            should: facility_query,
            filter: facility_filter,
          }
        },
        _source: [
          "facilityNPI"
        ]
      }
    );
    var services = [];
    if (location == null && lat == null && lon == null) {
      var result = await client.search(
        {
          from: 0, size: 1000,
          index: "hltest.pricelist",
          query: {
            bool: {
              should: [
                {
                  match: {
                    "DiagnosisTestorServiceName": {
                      query: q,
                      operator: "and"
                    }
                  }
                }
              ]
            }
          }
        }
      )
      // for (var service of result.hits.hits) {
      //   const FacilityDetails = await Facility.findOne({ facilityNPI: service._source?.FacilityNPI });
      //   // console.log(FacilityDetails,'facilitydetails')
      //   service._source.FacilityDetails = FacilityDetails;
      //   service._source.NegotiatedRates = await getNegotiatedRatesByCodeAndNPI(service._source?.ServiceCode, service._source?.FacilityNPI, serviceCode, insuranceProvider);
      //   service._source.distance = parseFloat((calcDistance(lat ?? 0, lon ?? 0, +FacilityDetails.GPSCoordinate.latitude, +FacilityDetails.GPSCoordinate.longitude) * 0.000621371).toFixed(2));
      //   services.push(service._source);
      // }

      // services = services.filter((value) => {
      //   if (value.NegotiatedRates.length != 0) {
      //     if (facilityType != null) {
      //       return value.FacilityDetails.facilityType.MainfacilityType == facilityType
      //     }
      //     return true;
      //   }
      //   return false;
      // });
    }
    var facilityNPIList = result.hits.hits.map((value) => value._source.facilityNPI);

    var query = [
      {
        terms: {
          "FacilityNPI": facilityNPIList,
        }
      }
    ];
    if (q.trim() !== '') {
      query.push(
        {
          match: {
            "DiagnosisTestorServiceName": {
              query: q,
              operator: "and"
            }
          }
        },
      )
    }
    var result = await client.search(
      {
        from: 0, size: 1000,
        index: "hltest.pricelist",
        query: {
          bool: {
            must: query
          }
        },
        _source: false,
      }
    )

    var serviceIDList = result.hits.hits.map((value) => value._id);
    console.log(serviceIDList);
    var serviceMatchQuary = {
      distance: {
        $gte: 0,
        $lte: 100,
      },
      "facilityDetails.negotiatedRates": {
        $ne: null,
      },
    };
    if (facilityType != null) {
      serviceMatchQuary['facilityDetails.facilityType.MainfacilityType'] = facilityType;
    }

    if (negotiatedRates != null) {
      serviceMatchQuary['$expr'] = {
        $and: [
          {
            $gte: [
              "$facilityDetails.negotiatedRates.negotiated_rates.negotiated_prices.negotiated_rate",
              negotiatedRates[0]
            ]
          },
          {
            $lte: [
              "$facilityDetails.negotiatedRates.negotiated_rates.negotiated_prices.negotiated_rate",
              negotiatedRates[1]
            ]
          },
        ],
      }
    }

    var serviceList = await Pricelist.aggregate(
      [
        {
          $match: {
            $expr: {
              $in: [
                {
                  $toString: "$_id",
                },
                serviceIDList,
              ],
            },
          },
        },
        {
          $lookup: {
            from: "Facility",
            let: {
              facilityNPI: "$FacilityNPI",
              serviceCode: "$ServiceCode",
              serviceName: "$DiagnosisTestorServiceName"
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $eq: [
                      "$facilityNPI",
                      "$$facilityNPI",
                    ],
                  },
                },
              },
              {
                $lookup: {
                  from: "NegotiatedRates",
                  let: {
                    facilityNPI: "$$facilityNPI",
                    serviceCode: "$$serviceCode",
                    serviceName: "$$serviceName"
                  },
                  pipeline: [
                    {
                      $match: {
                        $expr: {
                          $eq: [
                            "$billing_code",
                            "$$serviceCode",
                          ],
                        },
                      },
                    },
                    {
                      $match: {
                        $expr: {
                          $eq: [
                            "$name",
                            "$$serviceName",
                          ],
                        },
                      },
                    },
                    {
                      $unwind: {
                        path: "$negotiated_rates",
                        preserveNullAndEmptyArrays: true,
                      },
                    },
                    {
                      $unwind: {
                        path: "$negotiated_rates.negotiated_prices",
                        preserveNullAndEmptyArrays: true,
                      },
                    },
                    {
                      $unwind: {
                        path: "$negotiated_rates.negotiated_prices.service_code",
                        preserveNullAndEmptyArrays: true,
                      },
                    },
                    {
                      $unwind: {
                        path: "$negotiated_rates.provider_groups",
                        preserveNullAndEmptyArrays: true,
                      },
                    },
                    {
                      $unwind: {
                        path: "$negotiated_rates.provider_groups.npi",
                        preserveNullAndEmptyArrays: true,
                      },
                    },
                    {
                      $match: {
                        $expr: {
                          $eq: [
                            {
                              $toString:
                                "$negotiated_rates.provider_groups.npi",
                            },
                            "$$facilityNPI",
                          ],
                        },

                        insuranceProviderID: insuranceProvider,
                        "negotiated_rates.negotiated_prices.service_code": { $in: [serviceCode, 22] },
                      },
                    },
                    {
                      $project: {
                        _id: 0,
                        negotiation_arrangement: 1,
                        name: 1,
                        billing_code_type: 1,
                        billing_code_type_version: 1,
                        billing_code: 1,
                        description: 1,
                        negotiated_rates: 1,
                        insuranceProviderID: 1,
                      },
                    },
                  ],
                  as: "negRates",
                },
              },
              {
                $unwind: {
                  path: "$negRates",
                  preserveNullAndEmptyArrays: true,
                },
              },
              {
                $project: {
                  _id: 0,
                  facilityID: 1,
                  facilityNPI: 1,
                  facilityName: 1,
                  facilityNPI: 1,
                  facilityType: 1,
                  providerID: 1,
                  address: 1,
                  GPSCoordinate: 1,
                  email: 1,
                  contact: 1,
                  negotiatedRates: "$negRates",
                },
              },
            ],
            as: "facilityDetails",
          },
        },
        {
          $unwind: {
            path: "$facilityDetails",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            r: 6371,
            pibyeighty: {
              $divide: [3.14159265359, 180],
            },
          },
        },
        {
          $addFields: {
            dlat: {
              $multiply: [
                {
                  $subtract: [
                    {
                      $convert: {
                        input:
                          "$facilityDetails.GPSCoordinate.latitude",
                        to: "double",
                      },
                    },
                    {
                      $convert: {
                        input: lat ?? 0,
                        to: "double",
                      },
                    },
                  ],
                },
                "$pibyeighty",
              ],
            },
            dlong: {
              $multiply: [
                {
                  $subtract: [
                    {
                      $convert: {
                        input:
                          "$facilityDetails.GPSCoordinate.longitude",
                        to: "double",
                      },
                    },
                    {
                      $convert: {
                        input: lon ?? 0,
                        to: "double",
                      },
                    },
                  ],
                },
                "$pibyeighty",
              ],
            },
          },
        },
        {
          $addFields: {
            a: {
              $add: [
                {
                  $multiply: [
                    {
                      $sin: {
                        $divide: ["$dlat", 2],
                      },
                    },
                    {
                      $sin: {
                        $divide: ["$dlat", 2],
                      },
                    },
                  ],
                },
                {
                  $multiply: [
                    {
                      $cos: {
                        $multiply: [
                          {
                            $convert: {
                              input: lat ?? 0,
                              to: "double",
                            },
                          },
                          "$pibyeighty",
                        ],
                      },
                    },
                    {
                      $cos: {
                        $multiply: [
                          {
                            $convert: {
                              input:
                                "$facilityDetails.GPSCoordinate.latitude",
                              to: "double",
                            },
                          },
                          "$pibyeighty",
                        ],
                      },
                    },
                    {
                      $sin: {
                        $divide: ["$dlong", 2],
                      },
                    },
                    {
                      $sin: {
                        $divide: ["$dlong", 2],
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          $addFields: {
            distance: {
              $multiply: [
                {
                  $multiply: [
                    {
                      $multiply: [
                        6371,
                        {
                          $multiply: [
                            2,
                            {
                              $atan2: [
                                {
                                  $sqrt: "$a",
                                },
                                {
                                  $sqrt: {
                                    $subtract: [
                                      1,
                                      "$a",
                                    ],
                                  },
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    1000,
                  ],
                },
                0.000621371,
              ],
            },
          },
        },
        {
          $match: serviceMatchQuary,
        },
        {
          $project: {
            _id: 0,
            SNo: 1,
            ServiceCode: 1,
            DiagnosisTestorServiceName: 1,
            Organisationid: 1,
            OrganisationPrices: 1,
            FacilityNPI: 1,
            FacilityName: 1,
            FacilityPrices: 1,
            facilityDetails: 1,
            negotiatedRates: "$facilityDetails.negotiatedRates",
            distance: {
              $round: ["$distance", 2],
            },
            createdDate: 1,
            updatedDate: 1,
            createdBy: 1,
            updatedBy: 1,
          },
        },
        { $unset: "facilityDetails.negotiatedRates" },
        {
          $sort: {
            distance: 1,
          },
        },
      ]
    )
    services.push(...serviceList);

    var sortServicesbydistance = services.sort((a, b) => {
      return a.distance - b.distance;
    });

    return { data: sortServicesbydistance };
  } catch (e) {
    console.log(e)
    throw Error(e)
  }
}

async function serviceNameSearch(body) {
  const q = body.q ?? "";
  console.log(body, 'body')
  try {
    var result = await client.search(
      {
        from: 0, size: 1000,
        index: "hltest.pricelist",
        query: {
          "fuzzy": {
            "DiagnosisTestorServiceName": {
              "value": q,
              "fuzziness": "AUTO",
              "max_expansions": 50,
              "prefix_length": 0,
              "transpositions": true,
              "rewrite": "constant_score"
            }
          }
        },
        _source: [
          "DiagnosisTestorServiceName"
        ]
      }
    )

    var listServiceName = result.hits.hits.map((value) => value._source.DiagnosisTestorServiceName)

    var result = await client.search(
      {
        from: 0, size: 1000,
        index: "hltest.cashprice",
        query: {
          "fuzzy": {
            "serviceName": {
              "value": q,
              "fuzziness": "AUTO",
              "max_expansions": 50,
              "prefix_length": 0,
              "transpositions": true,
              "rewrite": "constant_score"
            }
          }
        },
        _source: [
          "serviceName"
        ]
      }
    )
    var cashPriceServiceName = result.hits.hits.map((value) => value._source.serviceName)
    var listServices = [...cashPriceServiceName, ...listServiceName]
    var serviceNameList = [];
    serviceNameList.push(...Array.from(new Set(listServices)))
    return { data: serviceNameList }
  }
  catch (e) {
    console.log(e)
    throw Error(e)
  }
}


async function serviceLocationSearch(body) {
  var lat = +body.lat;
  var lon = +body.lon;
  try {
    var serviceLocationList = await CityStateZipcode.aggregate([
      {
        $addFields: {
          r: 6371,
          pibyeighty: {
            $divide: [3.14159265359, 180],
          },
          input_lat: lat,
          input_lng: lon,
        },
      },
      {
        $addFields: {
          dlat: {
            $multiply: [
              {
                $subtract: [
                  {
                    $convert: {
                      input: "$LAT",
                      to: "double",
                    },
                  },
                  {
                    $convert: {
                      input: "$input_lat",
                      to: "double",
                    },
                  },
                ],
              },
              "$pibyeighty",
            ],
          },
          dlong: {
            $multiply: [
              {
                $subtract: [
                  {
                    $convert: {
                      input: "$LONG",
                      to: "double",
                    },
                  },
                  {
                    $convert: {
                      input: "$input_lng",
                      to: "double",
                    },
                  },
                ],
              },
              "$pibyeighty",
            ],
          },
        },
      },
      {
        $addFields: {
          a: {
            $add: [
              {
                $multiply: [
                  {
                    $sin: {
                      $divide: ["$dlat", 2],
                    },
                  },
                  {
                    $sin: {
                      $divide: ["$dlat", 2],
                    },
                  },
                ],
              },
              {
                $multiply: [
                  {
                    $cos: {
                      $multiply: [
                        {
                          $convert: {
                            input: "$input_lat",
                            to: "double",
                          },
                        },
                        "$pibyeighty",
                      ],
                    },
                  },
                  {
                    $cos: {
                      $multiply: [
                        {
                          $convert: {
                            input: "$LAT",
                            to: "double",
                          },
                        },
                        "$pibyeighty",
                      ],
                    },
                  },
                  {
                    $sin: {
                      $divide: ["$dlong", 2],
                    },
                  },
                  {
                    $sin: {
                      $divide: ["$dlong", 2],
                    },
                  },
                ],
              },
            ],
          },
        },
      },
      {
        $addFields: {
          distance: {
            $multiply: [
              {
                $multiply: [
                  {
                    $multiply: [
                      6371,
                      {
                        $multiply: [
                          2,
                          {
                            $atan2: [
                              {
                                $sqrt: "$a",
                              },
                              {
                                $sqrt: {
                                  $subtract: [
                                    1,
                                    "$a",
                                  ],
                                },
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  1000,
                ],
              },
              0.000621371,
            ],
          },
        },
      },
      {
        $sort:

        {
          distance: 1,
        },

      },
      {
        $limit: 1
      }
    ])
    if (serviceLocationList[0]) {
      return { data: serviceLocationList[0].ZIP_CODE }
    } else {
      return { data: null }
    }
  }
  catch (e) {
    console.log(e)
    throw Error(e)
  }
}






