<?php
namespace ccxt;
include_once (__DIR__.'/../../ccxt.php');
// ----------------------------------------------------------------------------

// PLEASE DO NOT EDIT THIS FILE, IT IS GENERATED AND WILL BE OVERWRITTEN:
// https://github.com/ccxt/ccxt/blob/master/CONTRIBUTING.md#how-to-contribute-code

// -----------------------------------------------------------------------------

error_reporting(E_ALL | E_STRICT);
date_default_timezone_set('UTC');

use ccxt\Precise;
use React\Async;
use React\Promise;


// Note, this is just an example and might not yet work on other exchanges, which are being still unified.
function example() {
    // ########## user inputs ##########
    return Async\async(function () {
        $exchange = new ('\\ccxt\\async\\binance')(array(
    'apiKey' => 'xxx',
    'secret' => 'xxx',
));
        $symbol = 'BUSD/USDT'; // set target symbol
        $margin_mode = 'isolated'; // margin mode (cross or isolated)
        $collateral_coin = 'USDT'; // which asset you want to use for margin-borrow collateral
        $borrow_coin = 'BUSD'; // which coin to borrow
        $order_side = 'sell'; // which side to trade
        $amount_to_trade = 20; // how many coins to sell
        $order_type = 'limit'; // order type (can be market, limit or etc)
        $limit_price = 0.99; // price to sell at (set undefined/null/None if market-order)
        $margin_magnitude = 5; // target margin (aka 'leverage'). This might also be obtainable using other unified methods, but for example purposes, we set here manually
        // ########## end of user-inputs ##########
        //
        // for example purposes, let's also check available balance at first
        $balance_margin = Async\await($exchange->fetch_balance(array(
    'defaultType' => 'margin',
    'marginMode' => $margin_mode,
))); // use `defaultType` because of temporary bug, otherwise, after several days, you can use `type` too.
        // if we don't have enought coins, then we have to borrow at first
        $needed_amount_to_borrow = null; // will be auto-set below
        if ($amount_to_trade > $balance_margin[$symbol][$borrow_coin]['free']) {
            $needed_amount_to_borrow = $amount_to_trade - $balance_margin[$symbol][$borrow_coin]['free'];
            var_dump('hmm, I have only ', $balance_margin[$symbol][$borrow_coin]['free'], ' ', $borrow_coin, ' in margin balance, and still need additional ', $needed_amount_to_borrow, ' to make an order. Lets borrow it.');
            // To initate a borrow, at first, check if we have enough collateral (for this example, as we make a sell-short, we need '-1' to keep for collateral currency)
            $needed_collateral_amount = $needed_amount_to_borrow / ($margin_magnitude - 1);
            // Check if we have any collateral to get permission for borrow
            if ($balance_margin[$symbol][$collateral_coin]['free'] < $needed_collateral_amount) {
                // If we don't have enough collateral, then let's try to transfer collateral-asset from spot-balance to margin-balance
                var_dump('hmm, I have only ', $balance_margin[$symbol][$collateral_coin]['free'], ' in balance, but ', $needed_collateral_amount, ' collateral is needed. I should transfer ', $needed_collateral_amount, ' from spot');
                // let's check if we have spot balance at all
                $balance_spot = Async\await($exchange->fetch_balance(array(
    'type' => 'spot',
)));
                if ($balance_spot[$collateral_coin]['free'] < $needed_collateral_amount) {
                    var_dump('hmm, I neither do have enough balance on spot - only ', $balance_spot[$collateral_coin]['free'], '. Script can not continue...');
                    return;
                } else {
                    var_dump('Transferring  ', $needed_collateral_amount, ' to margin account');
                    Async\await($exchange->transfer($collateral_coin, $needed_collateral_amount, 'spot', $margin_mode, array(
    'symbol' => $symbol,
))); // because of temporary bug, you have to round "needed_collateral_amount" manually to 8 decimals. will be fixed a few days later
                }
            }
            // now, as we have enough margin collateral, initiate borrow
            var_dump('Initiating margin borrow of ', $needed_amount_to_borrow, ' ', $borrow_coin);
            $borrow_result = Async\await($exchange->borrow_margin($borrow_coin, $needed_amount_to_borrow, $symbol, array(
    'marginMode' => $margin_mode,
)));
        }
        var_dump('Submitting order.');
        $order = Async\await($exchange->create_order($symbol, $order_type, $order_side, $amount_to_trade, $limit_price, array(
    'marginMode' => $margin_mode,
)));
        var_dump('Order was submitted !', $order['id']);
        //
        //
        // ...
        // ...
        // some time later, if you want to repay the loan back (like 'close the position')...
        // ...
        // ...
        //
        //
        // set the "repay-back" amount (for this example snippet, this will be same amount that we borrowed above)
        if ($needed_amount_to_borrow !== null) {
            $amount_to_repay_back = $needed_amount_to_borrow;
            // At first, you need to get back the borrowed coin, by making an opposide trade
            var_dump('Making purchase back of ' . $amount_to_repay_back . ' ' . $borrow_coin . ' to repay it back.');
            $purchase_back_price = 1.01;
            $order_back = Async\await($exchange->create_order($symbol, $order_type, ($order_side === 'buy' ? 'sell' : 'buy'), $amount_to_repay_back, $purchase_back_price, array(
    'marginMode' => $margin_mode,
)));
            var_dump('Now, repaying the loan.');
            $repay_result = Async\await($exchange->repay_margin($borrow_coin, $amount_to_repay_back, $symbol, array(
    'marginMode' => $margin_mode,
)));
            var_dump('finished.');
        }
    }) ();
}


example();
