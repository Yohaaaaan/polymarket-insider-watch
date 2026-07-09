-- Polymarket Insider Trading Detection - Dune Analytics Queries
-- Using the Dune Free Tier to backfill and test the hypothesis historically

-- Query 1: Find the large bets (USDC > $10k) on conditional markets
SELECT 
  t.maker as wallet_address,
  t.evt_block_time,
  t.makerAmountFilled / 1e6 as tokens_received,
  t.takerAmountFilled / 1e6 as usdc_spent,
  (t.takerAmountFilled * 1.0) / t.makerAmountFilled as implied_prob,
  t.makerAssetId as condition_token_id
FROM polymarket.CTFExchange_evt_OrderFilled t
WHERE t.takerAmountFilled / 1e6 > 10000
ORDER BY t.evt_block_time DESC
LIMIT 1000;

-- Query 2: Identify the wallet's age at the time of the bet (ad-hoc insider detection)
WITH wallet_first_tx AS (
  SELECT "from" as tx_from, MIN(block_time) as first_tx
  FROM polygon.transactions
  GROUP BY "from"
)
SELECT 
  p.maker as maker_wallet,
  w.first_tx as wallet_birthday,
  p.evt_block_time as trade_time,
  date_diff('day', w.first_tx, p.evt_block_time) as wallet_age_at_trade_days,
  (p.takerAmountFilled * 1.0) / p.makerAmountFilled as exact_implied_prob,
  p.takerAmountFilled / 1e6 as usdc_amount
FROM polymarket.CTFExchange_evt_OrderFilled p
JOIN wallet_first_tx w ON w.tx_from = p.maker
WHERE p.takerAmountFilled / 1e6 > 10000 
  AND date_diff('day', w.first_tx, p.evt_block_time) < 14 -- Wallets created < 14 days before the trade
ORDER BY wallet_age_at_trade_days ASC
LIMIT 100;

-- Query 3: Cluster Finder (Find the addresses funded by the same source wallet)
WITH funded_by_source AS (
  SELECT 
    "to", 
    "from" as source_fund
  FROM polygon.traces
  WHERE "value" > 0 AND success = true
  QUALIFY ROW_NUMBER() OVER(PARTITION BY "to" ORDER BY block_time ASC) = 1
)
SELECT 
  f.source_fund,
  array_agg(f."to") as wallets_funded,
  COUNT(f."to") as nb_wallets
FROM funded_by_source f
GROUP BY f.source_fund
HAVING COUNT(f."to") >= 3
ORDER BY nb_wallets DESC;
