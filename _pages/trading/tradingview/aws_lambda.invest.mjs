import axios from "axios"
import crypto from 'crypto'
import _ from "lodash"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"; // v3
// @https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/dynamodb/command/PutItemCommand/
import { PutCommand, DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb"; // v3


const dynOpt = {
  marshallOptions: {
    removeUndefinedValues: true
  }
}
const dynamoDbdocClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), dynOpt);

//import {S3Client, GetObjectCommand} from '@aws-sdk/client-s3';
//const s3client = new S3Client({ region: 'eu-west-3' }); 

const HOST_URL = 'https://demo-api-capital.backend-capital.com'
const fromBase64 = (base64String) => Buffer.from(base64String, 'base64').toString('utf-8')

// @https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/getting-started.html

const getSAMPLE = () => {
  // --------------------------------
  // Formula
  // Risk = size × (entry - stop loss)
  // ex: 0.5 × (73200 - 73000) = $100

  // Size controls RISK
  // Leverage controls CAPITAL REQUIRED
  // --------------------------------

  // --DEMO------------------------
  const _price = 73280
  const stopDistance = 2000
  const stopLoss = _price - stopDistance // 71100
  const takeProfit = _price + (3*stopDistance) // 76110

  //const riskPerTrade = 10 // $50 risk
  //const accountSize = 1000
  //const riskPercent = 0.01 // 1%
  //const riskAmount = accountSize * riskPercent
  //const size = riskPerTrade / stopDistance
  const size = 0.003
  // -------------------------------
return null
}

///////
// 1 //
///////
const parseHttpPostBody = (httpPost) => {

  try {
    const httpPostBody = _.isObject(httpPost.body)
      ? httpPost.body
      : JSON.parse(httpPost.body)
    console.log('INFO | httpParsedBody:', httpPostBody)
  
    return httpPostBody
  } catch (err) {
    console.error('ERROR parsing Http BODY:', err)
    console.error('ERROR | Received httpPost:', httpPost.body)
  } 
  
  console.error('ERROR on "parseHttpPostBody"')
}

const getObjectData = (httpPostBody, marketDetails) => {
  const object = {
    alertId: httpPostBody.id,
    alertEpic: httpPostBody.epic,
    alertDirection: httpPostBody.direction,
    alertOverrideMinStopPercent: httpPostBody.overrideMinStopPercent,
    alertProfitRiskMultiply: httpPostBody.profitRiskMultiply,
    alertRiskAmount: httpPostBody.riskAmount,
    alertTrailingStop: httpPostBody.trailingStop,
    marketAskPrice: marketDetails?.snapshot?.offer,
    marketBidPrice: marketDetails?.snapshot?.bid,
    marketGuaranteedStopAllowed: marketDetails?.instrument?.guaranteedStopAllowed,
    marketMinGuaranteedStopDistancePercent: marketDetails?.dealingRules?.minGuaranteedStopDistance?.value,
    marketMinStopOrProfitDistancePercent: marketDetails?.dealingRules?.minStopOrProfitDistance?.value,
    settedStopLossMultiplier: 1,
    getDirectionPrice() {
      return 'BUY' === this.alertDirection ? this.marketAskPrice : this.marketBidPrice
    },
    getMinStopPercent() {
      let minStopPercent = this.alertOverrideMinStopPercent ? this.alertOverrideMinStopPercent : this.marketMinStopOrProfitDistancePercent
      //return this.alertOverrideMinStopPercent ? this.alertOverrideMinStopPercent : this.marketMinStopOrProfitDistancePercent
      return /*minStopPercent*/ 0.001 * this.settedStopLossMultiplier
    },
    getStopDistance() {
      return this.getDirectionPrice() * this.getMinStopPercent()
    },
    getProfitDistance() {
      return this.getStopDistance() * this.alertProfitRiskMultiply
    },
    getSize() {
      return (this.alertRiskAmount / this.getStopDistance()).toFixed(5)
    }
  }

  return object
}


///////
// 2 //
///////
async function _scanDocAllItems() {
  try {
    const input = {
      TableName: "dynamodata", 
    }
    const scanCommand = new ScanCommand(input)
    const response = await dynamoDbdocClient.send(scanCommand)

    return response?.Items ?? null
  } catch (err) {
    console.log('err', err)
  }

  return null
}

async function _postDocOrderItem(orderData) {
  const _idDb = crypto.randomBytes(6).toString('hex') // 12 chars
  const _dateDb =  Date()
  const _itemDb = _.merge({order: orderData}, { id: _idDb, createdAt: _dateDb })

  const putCommand = new PutCommand({
    TableName: "dynamodata",
    Item: _itemDb,
    //ConditionExpression='attribute_not_exists(id)'
  });
  const response = await dynamoDbdocClient.send(putCommand)

  console.log('INFO | AWS DocDB Post', _idDb, _dateDb)

  return response
}

async function checkDuplicates(httpPost) {
  const scanAll = await _scanDocAllItems() 

  let canPostNewOrder = true
  for(let item of scanAll) {
    if (
      httpPost.id !== undefined
      && httpPost.id == item.order.id
    ) {
      canPostNewOrder = false
    }
  }

  if (canPostNewOrder) {
    console.log('OK, Posting new order', httpPost.id)
    await _postDocOrderItem(httpPost)
    return true
  } else {
    console.error('WARN, Order already exist', httpPost.id)
  }

  return false
}


// API //


///////
// 3 //
///////
const capitalAuthApi = async () => {
  // AUTH TO CAPITAL API
  
  const { headers: responseHeaders, data, status } =
    await axios.post(HOST_URL + "/api/v1/session",
    {
      "identifier": fromBase64(process.env.IDENTIFIER),
      "password": fromBase64(process.env.DEMO_API_PASS)
    },
    {
      headers: {
        "Content-Type": 'application/json',
        "X-CAP-API-KEY": fromBase64(process.env.DEMO_X_CAP_API_KEY)
      }
    }
  )

  if (status !== 200) {
    console.error(status, data)
    throw 'CAPITAL_CANNOT_AUTH_EXCEPTION'
  }

  const authData = {
    cst: responseHeaders.cst,
    securityToken: responseHeaders['x-security-token']
  }
  console.log('INFO: Capital API Auth', authData)

  return authData
}

///////
// 4 //
///////
const capitalGetMarketDetailsApi = async (epic, auth) => {

  const { data: marketResponse, status } =
    await axios.get(HOST_URL + "/api/v1/markets/" + epic,
    {
      headers: {
        "Content-Type": 'application/json',
        "CST": auth.cst,
        "X-SECURITY-TOKEN": auth.securityToken
      }
    }
  )

  if (status !== 200) {
    console.error(status, marketResponse.data)
    throw 'CAPITAL_CANNOT_GET_MARKET_DETAILS_EXCEPTION'
  }

  console.log('INFO: Capital GET Market details', marketResponse)

  return marketResponse
}


///////
// 5 //
///////

const mapDataToObject = (objectData) => {

  // BUY → position opens at offer
  // SELL → position opens at bid
  //const marketAskPrice = marketDetails?.snapshot?.offer
 // const marketBidPrice = marketDetails?.snapshot?.bid
  //const marketMinGuaranteedStopPercent = marketDetails?.dealingRules?.minGuaranteedStopDistance?.value
  //const isGuaranteedStopRequired = marketDetails?.instrument?.guaranteedStopAllowed
  //&& ['CRYPTOCURRENCIES'].includes(marketDetails?.instrument?.type)
  //const marketMinStopPercent = marketDetails?.dealingRules?.minStopOrProfitDistance?.value

  // === COMMON TrVw === //

  // - depends:
  // overrideMinStopPercent -> _stopDistance
  // profitRiskMultiply     -> _profitDistance
  // riskAmount             -> _size
  // -

  //const BTCUSD_MINSTOP = 0.006 // market: 0.01
  //const GOLD_MINSTOP   = 0.011 // market: 0.01

  /*const minStopPercent = 0.003 //marketMinStopPercent

  //if ('BTCUSD' === httpPostBody.epic) minStopPercent = 0.006 else if ('GOLD' === httpPostBody.epic) minStopPercent = 0.015
  if (httpPostBody.overrideMinStopPercent) minStopPercent = httpPostBody.overrideMinStopPercent

  const _stopDistance = //httpPostBody.overrideStopDistance ??
    // required for trailingStop
    'BUY' === httpPostBody.direction
      ? (marketAskPrice * minStopPercent)
      : (marketBidPrice * minStopPercent)

  const _profitDistance = 
    _stopDistance * httpPostBody.profitRiskMultiply

  // -> Is position size = risk / (stopDistance × valuePerUnit)?
  const _size = //httpPostBody.overrideSize ??
    (httpPostBody.riskAmount / _stopDistance).toFixed(5)*/

  // === common ===//

  // now dynamic...
  //let _stopDistance = null
  //let _profitDistance = null
  //let _size = null

  /*console.log('INFO Computed data', {
   // marketAskPrice: marketAskPrice,
   // marketBidPrice: marketBidPrice,
  //  marketMinStopPercent: marketMinStopPercent,
   // marketMinGuaranteedStopPercent: marketMinGuaranteedStopPercent,
  //  usedMinStopPercent: minStopPercent,
   // isGuaranteedStopRequired: isGuaranteedStopRequired,
    riskAmount: httpPostBody.riskAmount,
    directionPrice: 'BUY' === httpPostBody.direction ? 'ASK' : 'BID',
   // _stopDistance: _stopDistance,
   // _profitDistance: _profitDistance,
  //  _size: _size
  })*/

  let postingData = {
    id: objectData.alertId,
    epic: objectData.alertEpic,
    direction: objectData.alertDirection,
    size: objectData.getSize(),
    //optional
    stopDistance: objectData.getStopDistance(), 
    profitDistance: objectData.getProfitDistance(), 
    guaranteedStop: objectData.marketGuaranteedStopAllowed, // can't remove order with guaranteed
    trailingStop: objectData.alertTrailingStop,
    //stopLevel: httpPostBody.stopLevel, 
    //profitLevel: httpPostBody.profitLevel,
    //stopAmount: httpPostBody.stopAmount,
    //profitAmount: httpPostBody.profitAmount
  }

  return postingData
}


///////
// 6 //
///////
const _capitalPostOrderApi = async (capitalPostData, auth) => {
  //@https://open-api.capital.com/#tag/Trading-greater-Rositions/paths/~1api~1v1~1positions/post

  const { data: orderResponse, status: orderStatus } =
    await axios.post(HOST_URL + "/api/v1/positions",
      capitalPostData,
    {
      headers: {
        "Content-Type": 'application/json',
        "CST": auth.cst,
        "X-SECURITY-TOKEN": auth.securityToken
      }
    }
  )

  if (orderStatus !== 200) {
    console.error(orderStatus, orderResponse.data)
    throw 'CAPITAL_CANNOT_POST_ORDER_EXCEPTION'
  }

  console.log('INFO: Capital POST Order', { data: orderResponse, status: orderStatus })

  return  { data: orderResponse, status: orderStatus }
}

const capitalPostOrderWithRetryApi = async (objectData, auth) => {
  let lastResponseError = null
  for (let i=1; i<=20; i++) {
    objectData.settedStopLossMultiplier = i // retry loop
    let capitalPostData = mapDataToObject(objectData)
  
    try {
      let { data: orderResponse, status: orderStatus } = await _capitalPostOrderApi(capitalPostData, auth)
//console.log(orderResponse, orderStatus)
      if (200 === orderStatus) {
        return orderResponse?.dealReference
      }
    } catch (err) {
      //console.log('POST data on retry n°'+i, capitalPostData)
    //  console.log('BBB', err)
      const error = {
        "url": err.response.config.url,
        "postData": err.response.config.data,
        "retried": err.retried,
        "errorStatus": err.response.status,
        "errorCode": err.response.data.errorCode
      }
      console.error('posting data ERROR', JSON.stringify(error))

      // If another error than invalid stoploss, then break
      if (
        400 !== error.errorStatus
        || !error.errorCode.match(/^error\.invalid\.stoploss/)
      ) {
        break
      }

      lastResponseError = err
      lastResponseError.retried = i
      //throw err
    }
  } // endfor

  throw lastResponseError
}

///////
// 7 //
///////
const capitalConfirmOrderApi = async (dealReference, auth) => {

  const { data: confirmResponse, status } =
    await axios.get(HOST_URL + "/api/v1/confirms/" + dealReference,
    {
      headers: {
        "Content-Type": 'application/json',
        "CST": auth.cst,
        "X-SECURITY-TOKEN": auth.securityToken
      }
    }
  )

  if (status !== 200) {
    console.error(status, confirmResponse)
    throw 'CAPITAL_CANNOT_CONFIRM_ORDER_EXCEPTION'
  }

  console.log('INFO: Capital Confirmed Order', confirmResponse)

  return confirmResponse
}

export const handler = async (event, context) => {
  try {
    // DATA //
  
    const httpPostBody = parseHttpPostBody(event) // 1
    if (httpPostBody.token !== fromBase64(process.env.CAPITAL_TOKEN)) {
      throw 'INVALID_CAPITAL_TOKEN'
    }

    const _epic = httpPostBody.epic
    const canPostData = await checkDuplicates(httpPostBody) // 2

    if (!canPostData && !httpPostBody.devMode) {
      return "Warn, Duplicate. Abort process"
    }

    // API //

    const auth = await capitalAuthApi() // 3
    const marketDetails = await capitalGetMarketDetailsApi(_epic, auth) // 4
    const objectData = getObjectData(httpPostBody, marketDetails)
//console.log('OBJECT',objectData)
    //const postingDataObject = mapDataToObject(objectData) // 5


    const capitalPostOrderDealRef = await capitalPostOrderWithRetryApi(objectData, auth) // 6
    const capitalConfirmOrder = await capitalConfirmOrderApi(capitalPostOrderDealRef, auth) // 7

    return capitalConfirmOrder
  } catch (err) {
    console.log('AAA',err)
    const error = {
      "url": err.response.config.url,
      "postData": err.response.config.data,
      "retried": err.retried,
      "errorStatus": err.response.status,
      "errorCode": err.response.data.errorCode
    }
    console.error('FINAL ERROR', JSON.stringify(error))
    return "ERR " + JSON.stringify(error)
  }

  return "ERROR"
}
