# **Synapar Public API Documentation**

This document describes how to call the Synapar model's public inference API.

*Note: The API is for testing and research purposes only and does not constitute any investment advice or suggestion. We assume no responsibility for any investment or trading behavior based on AI-generated content. Public and free API calls may fail to be accessed due to technical failures, upgrades, or other reasons, or access may be closed after a notification is issued. If the same IP address accesses the API too frequently, access may be restricted.*

## **Endpoint**

POST `https://tdm-demo.vercel.app/api/synapar_api_inference`

*Note: In some countries or regions, it may be necessary to enable a VPN beforehand when accessing the endpoint.*

## **Request**

### **Headers**

| Key          | Value            |
|:-------------|:-----------------|
| Content-Type | application/json |

### **Body**

The request body must be a JSON object containing the following fields:

| Field                             | Type                                                          | Required | Default              | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
|:----------------------------------|:--------------------------------------------------------------|:---------|:---------------------|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| version                           | String                                                        | No       | "v0305_small"        | Specify the model version. Currently only `"v0305_small"` is supported.                                                                                                                                                                                                                                                                                                                                                                                     | 
| kline\_data                       | Array\[Array\[Number\]\] or Array\[Array\[Array\[Number\]\]\] | **Yes**  | --                   | K-line data with shape `(N, 7)` or `(Batch, N, 7)`. If the Batch dimension is present, it indicates batch inference is being performed, but it must be ensured that the sequence length N is consistent within the batch, and the batch size is within the range of `[1, 16]`. `N` within the range of `[256, 1024]` is the number of timesteps, and the `7` columns must strictly follow the order: `[timestamp, open, high, low, close, volume, amount]`. |
| frequency                         | String                                                        | **Yes**  | --                   | The frequency identifier for the K-line data. Must be one of the following values: `"1min", "5min", "15min", "30min", "1hour", "4hour", "1day", "1week"`. Recommendation: Use a `"1day"` frequency for stocks.                                                                                                                                                                                                                                              |
| kline\_window\_size               | Number                                                        | No       | 256                  | The maximum k-line window size. The model will use this length to truncate the last `N` records of kline\_data. Range `[256, 1024]`. Default `256`, max `1024`.                                                                                                                                                                                                                                                                                             |
| confidence\_threshold             | Number                                                        | No       | 0.5                  | Confidence threshold. The simulator will ignore `long / short` signals with a confidence lower than this value and treat them as `hold`. Range `[0, 1]`.                                                                                                                                                                                                                                                                                                    |
| allow\_short                      | Bool                                                          | No       | true                 | Whether short selling is allowed.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| quantity\_ratio\_type             | String                                                        | No       | "model"              | Position sizing mode. Options: `"model"`, `"half"`, `"full"`. `model`: follow the model's output for quantity and leverage. `half`: open/add with 50% of available funds; reduce 50% of holdings; leverage forced to 1x. `full`: open/add with 100% of available funds; reduce 100% of holdings; leverage forced to 1x.                                                                                                                                     |
| use\_leverage                     | Bool                                                          | No       | false                | Whether to enable leverage. Only effective when `quantity_ratio_type="model"`; otherwise it is forced off.                                                                                                                                                                                                                                                                                                                                                  |
| min\_leverage                     | Number                                                        | No       | 1.0                  | Minimum leverage. Range `[1, 20]`. Forced to 1.0 when leverage is disabled.                                                                                                                                                                                                                                                                                                                                                                                 |
| max\_leverage                     | Number                                                        | No       | 5.0                  | Maximum leverage. Range `[1, 20]`. Forced to 1.0 when leverage is disabled.                                                                                                                                                                                                                                                                                                                                                                                 |
| maintenance\_margin\_rate         | Number                                                        | No       | 1 / max_leverage / 2 | Maintenance margin ratio. Range `[0.01, 1.0]`. If not provided, it is computed as `1 / max_leverage / 2`.                                                                                                                                                                                                                                                                                                                                                   |
| allow\_floating\_profit\_to\_open | Bool                                                          | No       | false                | Whether unrealized profits can be used to open new positions. Only effective when `use_leverage=true`; forced to false when leverage is disabled.                                                                                                                                                                                                                                                                                                           |
| open\_fee\_rate                   | Number                                                        | No       | 0.005                | Opening fee rate, charged on notional value. 0.005 means 0.5%. Range `[0.0001, 0.01]`, i.e. 0.01% ~ 1%.                                                                                                                                                                                                                                                                                                                                                     |
| close\_fee\_rate                  | Number                                                        | No       | 0.008                | Closing fee rate, charged on notional value. 0.008 means 0.8%. Range `[0.0001, 0.01]`, i.e. 0.01% ~ 1%.                                                                                                                                                                                                                                                                                                                                                     |
| use\_max\_drawdown                | Bool                                                          | No       | false                | Whether to enable MDD risk control. When enabled, the simulator force-closes the position and resets the peak when drawdown exceeds `max_drawdown_limit`.                                                                                                                                                                                                                                                                                                   |
| max\_drawdown\_limit              | Number                                                        | No       | 0.20                 | Maximum drawdown limit. Only effective when `use_max_drawdown=true`. 0.20 means 20%. Range `[0.05, 0.99]`.                                                                                                                                                                                                                                                                                                                                                  |

*Note: The server does not download market data. The caller must provide complete, continuous, time-ascending K-line data in `kline_data`.*

### **K-line Data Format**

Single inference:

```text
[
  [timestamp, open, high, low, close, volume, amount],
  [timestamp, open, high, low, close, volume, amount],
  ...
]
```

Batch inference:

```text
[
  [
    [timestamp, open, high, low, close, volume, amount],
    ...
  ],
  [
    [timestamp, open, high, low, close, volume, amount],
    ...
  ]
]
```

Field meanings:

| Column Index | Field     | Description                                                        |
|:-------------|:----------|:-------------------------------------------------------------------|
| 0            | timestamp | Unix timestamp in seconds.                                         |
| 1            | open      | Opening price.                                                     |
| 2            | high      | Highest price.                                                     |
| 3            | low       | Lowest price.                                                      |
| 4            | close     | Closing price.                                                     |
| 5            | volume    | Trading volume.                                                    |
| 6            | amount    | Trading amount. Can be approximated as `volume * average price`.   |

Requirements:

* A single sequence length `N` must be at least `256` and at most `1024`.
* For batch inference, the batch size must be within `[1, 16]`, and all sequences in the same batch must have the same length.
* No trades are made in the first `128` steps; they are used only to provide historical context.
* Effective trading steps = truncated K-line length - `128`.
* For identical inputs, the model's outputs are precisely reproducible.

### **Request Example (curl)**

```bash
curl -X POST 'https://tdm-demo.vercel.app/api/synapar_api_inference' \
-H 'Content-Type: application/json' \
-d '{
  "version": "v0305_small",
  "frequency": "1day",
  "kline_window_size": 256,
  "confidence_threshold": 0.5,
  "allow_short": true,
  "quantity_ratio_type": "model",
  "use_leverage": false,
  "min_leverage": 1,
  "max_leverage": 5,
  "maintenance_margin_rate": 0.1,
  "allow_floating_profit_to_open": false,
  "open_fee_rate": 0.005,
  "close_fee_rate": 0.008,
  "use_max_drawdown": false,
  "max_drawdown_limit": 0.2,
  "kline_data": [
    [1678886400, 100, 105, 98, 102, 10000, 1020000],
    [1678972800, 102, 110, 101, 108, 12000, 1296000],
    [1679059200, 108, 109, 105, 106, 8000, 856000]
  ]
}'
```

*Note: The `kline_data` in the example above is for format illustration only. In actual use, `kline_data` must contain at least `256` records and at most `1024` records; if `kline_window_size` is used, the server will truncate to the last `N` records.*

## **Response**

### **Success Response (200 OK)**

Returns a JSON object containing the model's inference results and simulated trading data.

When the input is a single sequence, a single result object is returned.
When the input is a batch of sequences, `{ "batch_results": [ ... ] }` is returned.

The model's output comprises three key elements: direction, quantity, and leverage.

* Direction: Includes `long`, `short`, and `hold` instructions, along with their respective confidence scores.
* Quantity: A floating-point value within `[-1, 1]`. A positive value signifies the proportion of available capital to be used for opening or increasing a position; a negative value signifies the proportion of current holdings to be liquidated or reduced.
* Leverage: A floating-point value within `[0, 1]`, indicating the proportion of the permissible leverage (e.g., within a 1x to 20x range) to apply to the trade. This value is not applicable when closing or reducing a position.

*Note: To ensure sufficient historical context, no trades are made in the first `128` steps of each sequence.*

Single success response example:

```json
{
  "model_actions": [
    {
      "action_type": "hold",
      "quantity_ratio": 0.0,
      "leverage_ratio": 0.0,
      "confidence": 0.0
    },
    {
      "action_type": "long",
      "quantity_ratio": 0.5123,
      "leverage_ratio": 0.2345,
      "confidence": 0.85
    }
  ],
  "model_simulation_results": {
    "max_drawdown": 0.153,
    "sharpe_ratio": 1.25,
    "final_return_rate": 0.45,
    "effective_trading_steps": 128,
    "total_kline_steps": 256,
    "context_len": 128
  },
  "model_trade_log": [
    {
      "step": 130,
      "type": "open",
      "direction": "long",
      "price": 105.5,
      "quantity": 47.39,
      "fee": 25.0,
      "available_funds": 4975.0,
      "leverage": 1.0,
      "margin": 5000.0,
      "pnl": 0.0,
      "settled_pnl": 0.0,
      "position_after": 47.39,
      "avg_open_price_after": 105.5
    }
  ],
  "model_account_history": [
    {
      "step": 128,
      "total_assets": 10000.0,
      "available_funds": 10000.0,
      "occupied_margin": 0.0,
      "position_market_value": 0.0,
      "position_direction": "hold",
      "position_quantity": 0.0,
      "avg_open_price": 0.0,
      "action": "hold",
      "confidence": 0.0,
      "details": "Initial state",
      "leverage": 1.0,
      "quantity_ratio": 0.0,
      "action_leverage": 1.0,
      "position_value": 0.0,
      "unrealized_pnl": 0.0,
      "settled_pnl": 0.0,
      "maintenance_margin": 0.0,
      "drawdown": 0.0,
      "is_forced_close": false,
      "locked_profit": 0.0
    }
  ],
  "model_asset_curve": [
    10000.0,
    10000.0,
    14500.0
  ],
  "simulation_config": {
    "quantity_ratio_type": "model",
    "use_leverage": false,
    "min_leverage": 1.0,
    "max_leverage": 1.0,
    "maintenance_margin_rate": 0.1,
    "allow_floating_profit_to_open": false,
    "allow_short": true,
    "open_fee_rate": 0.005,
    "close_fee_rate": 0.008,
    "use_max_drawdown": false,
    "max_drawdown_limit": null
  },
  "simulation_stats": {
    "forced_close_count": 0,
    "force_reduce_count": 0,
    "max_leverage_used": 1.0,
    "avg_leverage_used": 1.0,
    "max_dynamic_leverage_used": 1.0
  },
  "how_to_understand_actions": "...",
  "model_version": "..."
}
```

Batch success response example:

```json
{
  "batch_results": [
    {
      "model_actions": [],
      "model_simulation_results": {},
      "model_trade_log": [],
      "model_account_history": [],
      "model_asset_curve": [],
      "simulation_config": {},
      "simulation_stats": {},
      "how_to_understand_actions": "...",
      "model_version": "..."
    }
  ]
}
```

### **Response Field Description**

| Field                        | Type   | Description                                                                                                                                                                                          |
|:-----------------------------|:-------|:-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| model\_actions               | Array  | Per-step model output. Length equals the truncated K-line length. The first `128` steps are padded with hold. Each element contains `action_type`, `quantity_ratio`, `leverage_ratio`, `confidence`. |
| model\_simulation\_results   | Object | Simulation metrics.                                                                                                                                                                                  |
| model\_trade\_log            | Array  | Trade log. Includes open, add, reduce, close, force_reduce, force_close records.                                                                                                                     |
| model\_account\_history      | Array  | Account history. Includes only effective trading steps, starting from step `128`.                                                                                                                    |
| model\_asset\_curve          | Array  | Full asset curve. Length equals the truncated K-line length; the first `128` values are the initial capital.                                                                                         |
| simulation\_config           | Object | The configuration actually applied in this simulation.                                                                                                                                               |
| simulation\_stats            | Object | Statistics on forced closes, forced reductions, and leverage usage.                                                                                                                                  |
| how\_to\_understand\_actions | String | Explanation of the model output.                                                                                                                                                                     |
| model\_version               | String | Model version information.                                                                                                                                                                           |

### **Failure Response**

* **400 Bad Request**: The request body does not comply with the specification (e.g., missing `kline_data` or `frequency`, or incorrect `kline_data` shape).  
```json
  {  
      "detail": "Request body error"  
  }
```

* **405 Method Not Allowed**: An HTTP method other than POST was used.  
* **500 Internal Server Error / 502 Bad Gateway / 504 Gateway Timeout**: An error occurred, e.g. inference failure, cold start timeout, etc.  
```json
  {  
      "detail": "..."
  }  
```

## **Trading Simulator Summary**

Simulated trading follows the rules below, which adapt to the controls in the request:

1. Direction
   * Long and short positions are both supported.
   * Short selling is allowed only if `allow_short=true`.
1. Reversal signals
   * When the model issues a signal opposite to the current position, the simulator closes the entire position and immediately opens a new position in the opposite direction.
1. Position sizing mode
   * `model`: follow the model's output. A positive `quantity_ratio` opens or adds using that proportion of available funds; a negative `quantity_ratio` reduces that proportion of the current holdings. Leverage is applied only if `use_leverage=true`.
   * `half`: open/add with 50% of available funds; reduce 50% of holdings. Leverage is forced to 1x.
   * `full`: open/add with 100% of available funds; reduce 100% of holdings. Leverage is forced to 1x.
1. Leverage
   * Only effective in `model` mode and when `use_leverage=true`.
   * Actual leverage = `min_leverage + leverage_ratio × (max_leverage − min_leverage)`.
   * `maintenance_margin_rate` determines when forced reduction or liquidation occurs. Its default value is `1 / max_leverage / 2`.
   * If `allow_floating_profit_to_open=false`, unrealized profits are locked and cannot be used to open or add to positions.
1. Fees
   * Opening and closing fees are charged on the notional value. Both rates are adjustable (default: open 0.5%, close 0.8%).
1. MDD control
   * If `use_max_drawdown=true`, the simulator force-closes the position when drawdown exceeds the limit, then resets the peak for re-baselining. Trading continues afterwards.
1. Mark-to-market
   * When leverage is used, positions are marked to market at each step before any trade. Profits or losses are settled into available funds, and the average open price is reset to the current close.
1. Execution & valuation price
   * Both the simulated execution price and the asset valuation price use the current K-line's closing price.
1. Forced reduction & liquidation
   * If total equity falls below the maintenance margin requirement or available funds become negative, the simulator forcibly reduces the position until the requirement is met or the position is closed. Such events appear in the logs as `FORCE REDUCE` or `FORCE CLOSE`.
1. Initial k-line window size
   * No trades are executed in the first `128` steps to ensure sufficient historical features. The effective trading steps equal the loaded K-line length minus `128`, and are displayed alongside the `Total Return` metric.

## **Disclaimer**

The API is for testing and research purposes only and does not constitute any investment advice or suggestion. We assume no responsibility for any investment or trading behavior based on AI-generated content. Public and free API calls may fail to be accessed due to technical failures, upgrades, or other reasons, or access may be closed after a notification is issued. If the same IP address accesses the API too frequently, access may be restricted.
