import os
import sys

root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.append(root + '/python')

# ----------------------------------------------------------------------------

# PLEASE DO NOT EDIT THIS FILE, IT IS GENERATED AND WILL BE OVERWRITTEN:
# https://github.com/ccxt/ccxt/blob/master/CONTRIBUTING.md#how-to-contribute-code

# ----------------------------------------------------------------------------

import ccxt  # noqa: E402


# AUTO-TRANSPILE #
def example():
    myex = ccxt.okx({})
    from_timestamp = myex.milliseconds() - 86400 * 1000  # last 24 hrs
    ohlcv = myex.fetch_ohlcv('BTC/USDT', '1m', from_timestamp, 3, {
    'whatever': 123,
})
    length = len(ohlcv)
    if length > 0:
        last_price = ohlcv[length - 1][4]
        print('Fetched ' + length + ' candles for ' + myex.id + ':  last close ' + last_price)
    else:
        print('No candles have been fetched')


example()
