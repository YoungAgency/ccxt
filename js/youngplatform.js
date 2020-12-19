'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { ArgumentsRequired, OrderNotFound, InvalidOrder, NotSupported, BadRequest } = require ('./base/errors');
const { TICK_SIZE } = require ('./base/functions/number');

//  ---------------------------------------------------------------------------

module.exports = class youngplatform extends Exchange {
    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'youngplatform',
            'name': 'YoungPlatform',
            'countries': ['IT'],
            'rateLimit': 2000,
            'certified': false,
            'pro': false,
            // new metainfo interface
            'has': {
                'fetchClosedOrders': true,
                'fetchOHLCV': true,
                'fetchTrades': true,
                'fetchTime': 'emulated', // TODO
                'fetchOrderBook': true,
                'fetchMarkets': true,
                'fetchTicker': true,
                'fetchTickers': true,
                'fetchBalance': true,
                'fetchOpenOrders': true,
                'fetchOrder': true,
                'fetchCurrencies': true,
                'fetchMyTrades': true,
                'createOrder': true,
                'createMarketOrder': true,
                'cancelOrder': true,
                'cancelAllOrders': true,
                'fetchDepositAddress': true,
                'withdraw': true,
            },
            'timeframes': {
                '1m': 1,
                '5m': 5,
                '15m': 15,
                '1h': 60,
                '4h': 240,
                '1d': 1440,
                '1w': 10080,
                '1M': 43200,
            },
            'urls': {
                'logo': 'https://exchange.youngplatform.com/61be7df7438ee83abe1fd2e37c7b71bf.svg',
                'test': {
                    'public': 'https://testnode.youngplatform.com',
                    'private': 'https://testnode.youngplatform.com/order/v2',
                },
                'api': {
                    'public': 'https://node1.youngplatform.com',
                    'private': 'https://node1.youngplatform.com/order/v2',
                },
                'www': 'https://pro.youngplatform.com',
                'doc': [],
                'fees': 'https://pro.youngplatform.com/fees',
            },
            'api': {
                'public': {
                    'get': [
                        'market/get-market-summary/{pair}',
                        'api/GetSettings',
                        'api/CurrencySettings',
                        'cmc/v1/orderbook/{pair}/{limit}',
                        'market/get-trade-history/{pair}',
                        'market/get-chart-data',
                    ],
                    'put': [],
                    'post': [],
                    'delete': [],
                },
                'private': {
                    'get': [],
                    'post': [
                        'get-balance',
                        'PlaceOrder',
                        'cancel-my-order',
                        'cancel-all-my-orders',
                        'GenerateAddress',
                        'my-order-history',
                        'my-order-status',
                        'my-trade-history',
                    ],
                    'delete': [],
                },
            },
            'precisionMode': TICK_SIZE,
            'fees': {
                'trading': {
                    'tierBased': false,
                    'percentage': true,
                    'taker': 0.2,
                    'maker': 0.2,
                },
            },
            'commonCurrencies': {
                'MCDAI': 'DAI',
            },
            // exchange-specific options
            'options': {
                // 'fetchTradesMethod': 'publicGetAggTrades', // publicGetTrades, publicGetHistoricalTrades
                'defaultTimeInForce': 'GTC', // 'GTC' = Good To Cancel (default), 'IOC' = Immediate Or Cancel
                'recvWindow': 5 * 1000, // 5 sec
                'timeDifference': 0, // the difference between system clock and Binance clock
                'adjustForTimeDifference': false, // controls the adjustment logic upon instantiation
            },
            // https://binance-docs.github.io/apidocs/spot/en/#error-codes-2
            'exceptions': {},
        });
    }

    nonce () {
        return this.milliseconds () - this.options['timeDifference'];
    }

    async fetchTime (params = {}) {
        return this.milliseconds ();
    }

    async loadTimeDifference (params = {}) {
        const serverTime = await this.fetchTime (params);
        const after = this.milliseconds ();
        this.options['timeDifference'] = after - serverTime;
        return this.options['timeDifference'];
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        if (!(api in this.urls['api'])) {
            throw new NotSupported (this.id + ' does not have a testnet/sandbox URL for ' + api + ' endpoints');
        }
        let request = '/' + this.implodeParams (path, params);
        const query = this.omit (params, this.extractParams (path));
        if (method === 'GET') {
            if (Object.keys (query).length) {
                request += '?' + this.urlencode (query);
            }
        }
        if (api === 'private') {
            if (params['limit'] !== undefined) {
                request += '?' + this.urlencode ({ 'limit': params['limit'], 'page': params['page'] });
                delete params['limit'];
                delete params['page'];
            }
            this.checkRequiredCredentials ();
            const nonce = parseInt (this.nonce () / 1000);
            params = this.extend ({ 'timestamp': nonce, 'recvWindow': 5000 }, params);
            const hmac = this.getHmacFromObject (params);
            body = this.json (params);
            headers = {
                'apiKey': this.apiKey,
                'HMAC': hmac,
                'Content-Type': 'application/json',
            };
        }
        const url = this.urls['api'][api] + request;
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    async fetchBalance (params = {}) {
        let currency = this.safeString (params, 'currency');
        if (currency === undefined) {
            currency = 'ALL';
        } else {
            currency = this.currencyId (currency);
        }
        params['currency'] = currency;
        const response = await this.privatePostGetBalance (params);
        const balances = this.safeValue (response, 'data', {});
        const result = { 'info': balances };
        for (let i = 0; i < balances.length; i++) {
            const currencyId = this.safeString (balances[i], 'currency');
            const code = this.safeCurrencyCode (currencyId);
            const account = this.account ();
            const free = this.safeFloat (balances[i], 'balance');
            const used = this.safeFloat (balances[i], 'balanceInTrade');
            const total = free + used;
            account['total'] = total;
            account['free'] = free;
            account['used'] = used;
            result[code] = account;
        }
        return this.parseBalance (result);
    }

    async createOrder (symbol, type, side, amount, price = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const exchangeType = type.toUpperCase ();
        const exchangeSide = side.toUpperCase ();
        const baseId = market['id'].split ('_')[1];
        const quoteId = market['id'].split ('_')[0];
        const request = {
            'market': quoteId,
            'trade': baseId,
            'side': exchangeSide,
            'type': exchangeType, // MARKET, LIMIT, STOPLIMIT
            'volume': this.amountToPrecision (symbol, amount),
        };
        if (exchangeType === 'LIMIT') {
            if (price === undefined) {
                throw new InvalidOrder (this.id + ' createOrder method requires a price argument for a ' + type + ' order');
            }
            request['rate'] = this.priceToPrecision (symbol, price);
            const timeInForce = this.safeString (params, 'timeInForce');
            if (timeInForce !== undefined) {
                if (timeInForce !== 'GTC' && timeInForce !== 'IOC' && timeInForce !== 'FOK') {
                    request['timeInForce'] = timeInForce;
                }
            }
        }
        if (exchangeType === 'STOPLIMIT') {
            const stopPrice = this.safeFloat (params, 'stopPrice');
            if (price === undefined) {
                throw new InvalidOrder (this.id + ' createOrder method requires a price argument for a ' + type + ' order');
            }
            if (stopPrice === undefined) {
                throw new InvalidOrder (this.id + ' createOrder method requires a stop argument for a ' + type + ' order');
            }
            request['rate'] = this.priceToPrecision (symbol, price);
            request['stop'] = this.priceToPrecision (symbol, stopPrice);
        }
        if (exchangeType === 'STOPMARKET') {
            const stopPrice = this.safeFloat (params, 'stopPrice');
            if (stopPrice === undefined) {
                throw new InvalidOrder (this.id + ' createOrder method requires a stop argument for a ' + type + ' order');
            }
            request['stop'] = this.priceToPrecision (symbol, stopPrice);
            request['timeInForce'] = 'GTC';
        }
        if (exchangeType === 'MARKET') {
            if (price !== undefined) {
                throw new InvalidOrder (this.id + ' createOrder method does not support price argument for a ' + type + ' order');
            }
        }
        const response = await this.privatePostPlaceOrder (request);
        //
        //     {
        //         status: 'Success',
        //         data: {
        //             "orderId": 214083724
        //         }
        //    }
        //
        const timestamp = this.seconds ();
        const result = this.safeValue (response, 'data');
        const id = this.safeInteger (result, 'orderId');
        const order = {
            'id': id,
            'info': response,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': symbol,
            'type': type,
            'side': side,
            'price': price,
            'amount': amount,
            'cost': undefined,
            'average': undefined,
            'filled': undefined,
            'remaining': undefined,
            'status': undefined,
            'fee': undefined,
            'trades': undefined,
        };
        return order;
    }

    async cancelOrder (id, symbol = undefined, params = {}) {
        await this.loadMarkets ();
        let response = undefined;
        response = await this.privatePostCancelMyOrder (this.extend ({
            'orderId': parseInt (id),
            'side': 'ALL',
        }, params));
        const data = this.safeValue (response, 'data');
        if (data === 'Order not found.') {
            throw new OrderNotFound (this.id + ' cancelOrder() error order not found');
        }
        return response;
    }

    async cancelAllOrders (symbol = undefined, params = {}) {
        if (symbol === undefined) {
            throw new ArgumentsRequired (this.id + ' cancelAllOrders requires a symbol argument');
        }
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'pair': market['id'],
            'side': 'ALL',
        };
        const response = await this.privatePostCancelAllMyOrders (request);
        return response;
    }

    async fetchDepositAddress (code, params = {}) {
        await this.loadMarkets ();
        const currencies = await this.fetchCurrencies ();
        const currency = this.safeValue (currencies, code);
        if (currency === undefined) {
            throw BadRequest (this.id + ' fetchDepositAddress() error invalid currency');
        }
        const request = {
            'currency': currency['id'],
        };
        const separator = currency['info']['addressSeparator'].toLowerCase ();
        const response = await this.privatePostGenerateAddress (request); // overwrite methods
        const result = response['data'];
        let address = this.safeString (result, 'Address');
        let tag = '';
        if (separator !== undefined && separator !== '') {
            const s = address.toLowerCase ().split (separator);
            tag = s[1];
            address = address.substr (
                0,
                s[0].length
            );
        }
        this.checkAddress (address);
        return {
            'currency': code,
            'address': address,
            'tag': tag,
            'info': response,
        };
    }

    async fetchOpenOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'side': 'ALL',
            'pair': market['id'],
            'openOrders': true,
        };
        if (limit !== undefined) {
            request['limit'] = limit;
        } else {
            request['limit'] = 20;
        }
        if (params['page'] !== undefined) {
            request['page'] = params['page'];
        } else {
            request['page'] = 1;
        }
        const response = await this.privatePostMyOrderHistory (request);
        const data = this.safeValue (response, 'data');
        const orders = this.safeValue (data, 'orders');
        return this.parseOrders (orders, market, since, limit);
    }

    async fetchClosedOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'side': 'ALL',
            'pair': market['id'],
            'openOrders': false,
            'limit': 20,
            'page': 1,
        };
        if (limit !== undefined) {
            request['limit'] = limit;
        }
        if (params['page'] !== undefined) {
            request['page'] = params['page'];
        }
        const response = await this.privatePostMyOrderHistory (request);
        const data = this.safeValue (response, 'data');
        const orders = this.safeValue (data, 'orders');
        return this.parseOrders (orders, market, since, limit);
    }

    async fetchOrder (id, symbol = undefined, params = {}) {
        await this.loadMarkets ();
        const request = {
            'side': 'ALL',
            'OrderId': id,
        };
        const response = await this.privatePostMyOrderStatus (request);
        const order = this.safeValue (response, 'data');
        return this.parseOrder (this.normalizeOrderObject (order));
    }

    async fetchMarkets (params = {}) {
        const response = await this.publicGetApiGetSettings ();
        if (this.options['adjustForTimeDifference']) {
            await this.loadTimeDifference ();
        }
        const data = this.safeValue (response, 'data');
        const res = this.safeValue (data, 'trade_setting');
        const result = [];
        for (let i = 0; i < res.length; i++) {
            const market = res[i];
            const baseId = this.safeString (market, 'coinName');
            const quoteId = this.safeString (market, 'marketName');
            const id = quoteId + '_' + baseId;
            const base = this.safeCurrencyCode (baseId);
            const quote = this.safeCurrencyCode (quoteId);
            const symbol = base + '/' + quote;
            const active = this.safeValue (market, 'tradeEnabled');
            const taker = this.safeFloat (market, 'takerFee');
            const maker = this.safeFloat (market, 'makerFee');
            const lotSize = this.safeFloat (market, 'minTradeAmount');
            const tickSize = this.safeFloat (market, 'minTickSize');
            const minCost = this.safeFloat (market, 'minOrderValue');
            // TODO: precision
            result.push ({
                'id': id,
                'symbol': symbol,
                'base': base,
                'quote': quote,
                'active': active,
                'precision': {
                    'amount': lotSize,
                    'price': tickSize,
                },
                'taker': taker,
                'maker': maker,
                'limits': {
                    'amount': {
                        'min': undefined,
                        'max': undefined,
                    },
                    'price': {
                        'min': undefined,
                        'max': undefined,
                    },
                    'cost': {
                        'min': minCost,
                        'max': undefined,
                    },
                },
                'info': market,
            });
        }
        return result;
    }

    async fetchTicker (symbol, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'pair': market['id'],
        };
        const response = await this.publicGetMarketGetMarketSummaryPair (request);
        const ticker = this.safeValue (response, 'data');
        return this.parseTicker (ticker, market['id']);
    }

    async fetchTickers (symbol = undefined, params = {}) {
        await this.loadMarkets ();
        const request = {
            'pair': '', // force fetch all tickers
        };
        const response = await this.publicGetMarketGetMarketSummaryPair (request);
        const tickers = this.safeValue (response, 'data');
        return this.parseTickers (tickers);
    }

    async fetchCurrencies (params = {}) {
        const response = await this.publicGetApiCurrencySettings (params);
        const currencies = this.safeValue (response, 'data');
        const result = {};
        for (let i = 0; i < currencies.length; i++) {
            const id = this.safeString (currencies[i], 'shortName');
            // fees can have both percentage and flat fee
            const code = this.safeCurrencyCode (id);
            const name = this.safeString (currencies[i], 'fullName');
            const decimal = this.safeInteger (currencies[i], 'decimalPrecision');
            const precision = Math.pow (10, -decimal);
            // is active only if all of the below are true
            const buyEnabled = this.safeValue (currencies[i], 'tradeEnabled_Buy');
            const sellEnabled = this.safeValue (currencies[i], 'tradeEnabled_Sell');
            const depositEnabled = this.safeValue (currencies[i], 'depositEnabled');
            const withdrawalEnabled = this.safeValue (currencies[i], 'withdrawalEnabled');
            let feeType = this.safeString (currencies[i], 'withdrawalServiceChargeType');
            let flatFee = this.safeFloat (currencies[i], 'withdrawalServiceCharge');
            let feePercentage = this.safeFloat (currencies[i], 'withdrawalServiceChargeInBTC');
            if (feeType === 'Percentage') {
                if (feePercentage === 0) {
                    feePercentage = this.safeFloat (currencies[i], 'withdrawalServiceCharge');
                    flatFee = 0;
                } else {
                    feeType = 'Mixed';
                }
            }
            const active = buyEnabled && sellEnabled && depositEnabled && withdrawalEnabled;
            result[code] = {
                'id': id,
                'code': code,
                'name': name,
                'active': active,
                // Warning: fee can be both percentage and flat. The `fee` field will have the flat one
                'fee': flatFee,
                'precision': precision,
                'limits': {
                    'amount': {
                        'min': undefined,
                        'max': undefined,
                    },
                    'price': {
                        'min': undefined,
                        'max': undefined,
                    },
                    'cost': {
                        'min': undefined,
                        'max': undefined,
                    },
                    'withdraw': {
                        'min': undefined,
                        'max': undefined,
                    },
                },
                'info': currencies[i],
                // custom
                'buyEnabled': buyEnabled,
                'sellEnabled': sellEnabled,
                'depositEnabled': depositEnabled,
                'withdrawalEnabled': withdrawalEnabled,
                'feeType': feeType, // Fixed | Percentage | Mixed
                'feePercentage': feePercentage,
            };
        }
        return result;
    }

    async fetchOrderBook (symbol, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        if (limit === undefined) {
            limit = 0;
        }
        const request = {
            'pair': market['id'],
            'limit': limit,
        };
        const response = await this.publicGetCmcV1OrderbookPairLimit (this.extend (request, params));
        const result = this.safeValue (response, 'data', {});
        return this.parseOrderBook (result);
    }

    async fetchTrades (symbol, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const id = market['id'];
        const request = {
            'pair': id,
        };
        // WARNING: pagination not implemented yet. TODO
        const response = await this.publicGetMarketGetTradeHistoryPair (this.extend (request, params));
        const result = response['data'];
        const length = result.length;
        if (length <= 0) {
            return [];
        }
        const normalizedTrades = [];
        for (let i = 0; i < result.length; i++) {
            normalizedTrades.push (this.normalizeTradeObject (result[i], market));
        }
        return this.parseTrades (normalizedTrades, market);
    }

    async fetchOHLCV (symbol, timeframe = '1m', since = undefined, limit = 100, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const pair = market['id'];
        const quote = pair.split ('_')[0];
        const base = pair.split ('_')[1];
        let minutes = this.timeframes[timeframe];
        if (minutes === undefined) {
            minutes = 1;
        }
        const oldSince = since;
        if (since === undefined) {
            since = this.milliseconds ();
        } else {
            // recalculate the timestamp. The exchange expects the `until' timestamp instead of since
            since = since + (limit * (minutes * (60 * 1000)));
        }
        const request = {
            'baseCurrency': base,
            'quoteCurrency': quote,
            'interval': minutes,
            'timestamp': since,
            'limit': limit,
        };
        const response = await this.publicGetMarketGetChartData (this.extend (request, params));
        const result = this.safeValue (response, 'data', {});
        // revert since to avoid the check in parseOHLCVs where candles outside the timestamp are removed
        since = oldSince;
        return this.parseOHLCVs (result, market, timeframe, since, limit);
    }

    async fetchMyTrades (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        const market = this.market (symbol);
        const request = {
            'side': 'ALL',
            'pair': market['id'],
            'openOrders': false,
            'limit': 20,
            'page': 1,
        };
        if (limit !== undefined) {
            request['limit'] = limit;
        }
        if (params['page'] !== undefined) {
            request['page'] = params['page'];
        }
        const response = await this.privatePostMyTradeHistory (request);
        const trades = response['data']['trades'];
        return this.parseTrades (trades, market);
    }

    normalizeOrderObject (order) {
        return {
            'orderId': order['OrderId'],
            'market': order['Market'],
            'trade': order['Trade'],
            'volume': order['Volume'],
            'pendingVolume': order['PendingVolume'],
            'orderStatus': order['Status'],
            'rate': order['Price'],
            'placementDate': order['PlacementDate'],
            'completionDate': order['CompletionDate'],
            'side': order['Side'],
            'type': order['Type'],
        };
    }

    parseOrder (order, market = undefined) {
        let side = this.safeString (order, 'side');
        if (side !== undefined) {
            side = side.toLowerCase ();
        }
        let type = this.safeString (order, 'type');
        if (type !== undefined) {
            type = type.toLowerCase ();
        }
        const marketCurrency = this.safeString (order, 'market');
        const tradeCurrency = this.safeString (order, 'trade');
        const marketId = marketCurrency + '_' + tradeCurrency;
        market = this.markets_by_id[marketId];
        const orderStatus = this.safeValue (order, 'orderStatus');
        let dateTime = undefined;
        if (orderStatus) {
            // closed order
            dateTime = this.safeString (order, 'completionDate');
        } else {
            // open order
            dateTime = this.safeString (order, 'placementDate');
        }
        const timestamp = this.parse8601 (dateTime);
        const amount = this.safeFloat (order, 'volume');
        const remaining = this.safeFloat (order, 'pendingVolume');
        const filled = amount - remaining;
        const price = this.safeFloat (order, 'rate');
        const cost = price * filled;
        let symbol = undefined;
        if (market !== undefined) {
            symbol = market['symbol'];
        }
        const status = this.parseOrderStatus (orderStatus, filled);
        const rawTrades = this.safeValue (order, 'mOrders');
        let averagePrice = 0;
        let fee = 0;
        const trades = [];
        if (rawTrades !== undefined && rawTrades.length !== 0) {
            for (let i = 0; i < rawTrades.length; i++) {
                const tradePrice = this.safeFloat (rawTrades[i], 'rate');
                averagePrice += tradePrice;
                const tradeFee = this.safeFloat (rawTrades[i], 'serviceCharge');
                fee += tradeFee;
                trades.push (this.parseTrade (rawTrades[i]));
            }
            averagePrice = averagePrice / trades.length;
        }
        const id = this.safeValue (order, 'orderId');
        return {
            'id': id,
            'clientOrderId': undefined,
            'info': order,
            'timestamp': timestamp,
            'datetime': dateTime,
            'lastTradeTimestamp': undefined,
            'status': status,
            'symbol': symbol,
            'type': type,
            'side': side,
            'price': price,
            'cost': cost,
            'amount': amount,
            'filled': filled,
            'average': averagePrice,
            'remaining': remaining,
            'fee': fee,
            'trades': trades,
        };
    }

    parseOrderStatus (status, filled) {
        let orderStatus = undefined;
        if (!status) {
            orderStatus = 'open';
        } else if (filled === 0) {
            orderStatus = 'canceled';
        } else {
            orderStatus = 'closed';
        }
        return orderStatus;
    }

    parseOHLCV (ohlcv, market = undefined) {
        return [
            this.safeInteger (ohlcv, 'time'),
            this.safeFloat (ohlcv, 'open'),
            this.safeFloat (ohlcv, 'high'),
            this.safeFloat (ohlcv, 'low'),
            this.safeFloat (ohlcv, 'close'),
            this.safeFloat (ohlcv, 'volume'),
        ];
    }

    normalizeTradeObject (trade, market = undefined) {
        const id = this.safeValue (trade, 'TradeID');
        const rate = this.safeFloat (trade, 'Rate');
        const volume = this.safeFloat (trade, 'Volume');
        const cost = this.safeFloat (trade, 'Total');
        const side = this.safeString (trade, 'Type');
        const date = this.safeString (trade, 'Date');
        const s = market['id'].split ('_');
        const base = s[1];
        const quote = s[0];
        return {
            'orderId': id.toString (),
            'volume': volume,
            'rate': rate,
            'trade': base,
            'market': quote,
            'amount': cost,
            'serviceCharge': undefined,
            'date': date,
            'side': side.toUpperCase (),
        };
    }

    parseTrade (trade, market = undefined) {
        const id = this.safeValue (trade, 'orderId');
        const rate = this.safeFloat (trade, 'rate');
        const volume = this.safeFloat (trade, 'volume');
        const cost = this.safeFloat (trade, 'amount');
        const side = this.safeString (trade, 'side');
        const date = this.safeString (trade, 'date');
        const fee = this.safeFloat (trade, 'serviceCharge');
        const baseId = this.safeString (trade, 'trade');
        const quoteId = this.safeString (trade, 'market');
        const marketId = quoteId + '_' + baseId;
        const symbol = this.markets_by_id[marketId]['symbol'];
        const timestamp = this.parse8601 (date);
        return {
            'id': undefined,
            'order': id,
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': symbol,
            'type': undefined,
            'side': side.toLowerCase (),
            'takerOrMaker': undefined,
            'price': rate,
            'amount': volume,
            'cost': cost,
            'fee': fee,
        };
    }

    parseTickers (rawTickers, market = undefined) {
        const tickers = {};
        const pairs = Object.keys (rawTickers);
        for (let i = 0; i < pairs.length; i++) {
            const symbol = this.safeSymbol (pairs[i]);
            tickers[symbol] = this.parseTicker (rawTickers[pairs[i]], pairs[i]);
        }
        return tickers;
    }

    parseTicker (ticker, marketId = undefined) {
        const timestamp = this.milliseconds ();
        const symbol = this.safeSymbol (marketId);
        const last = this.safeFloat (ticker, 'Last');
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'high': this.safeFloat (ticker, 'High_24hr'),
            'low': this.safeFloat (ticker, 'Low_24hr'),
            'bid': this.safeFloat (ticker, 'HeighestBid'),
            'bidVolume': undefined,
            'ask': this.safeFloat (ticker, 'LowestAsk'),
            'askVolume': undefined,
            'vwap': this.safeFloat (ticker, 'weightedAvgPrice'),
            'open': this.safeFloat (ticker, 'openPrice'),
            'close': last,
            'last': last,
            'previousClose': undefined,
            'change': undefined,
            'percentage': this.safeFloat (ticker, 'PercentChange'),
            'average': undefined,
            'baseVolume': this.safeFloat (ticker, 'QuoteVolume'),
            'quoteVolume': this.safeFloat (ticker, 'BaseVolume'),
            'info': ticker,
        };
    }

    getHmacFromObject (data) {
        let queryString = '';
        const keys = Object.keys (data);
        keys.sort ();
        for (let i = 0; i < keys.length; i++) {
            queryString += keys[i] + '=' + data[keys[i]];
            if (i < keys.length - 1) {
                queryString += '&';
            }
        }
        const hmac = this.hmac (queryString, this.secret, 'sha512', 'hex');
        const hmacString = hmac.toUpperCase ();
        return hmacString;
    }
};

