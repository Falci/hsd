'use strict';

const assert = require('bsert');
const Network = require('../lib/protocol/network');
const FullNode = require('../lib/node/fullnode');
const Address = require('../lib/primitives/address');
const rules = require('../lib/covenants/rules');
const { Resource } = require('../lib/dns/resource');
const WalletClient = require('../lib/client/wallet');

const network = Network.get('regtest');
const { treeInterval, biddingPeriod, revealPeriod, transferLockup } =
  network.names;

const node = new FullNode({
  memory: true,
  network: 'regtest',
  plugins: [require('../lib/wallet/plugin')],
});
const wclient = new WalletClient({
  port: network.walletPort,
});
const { wdb } = node.require('walletdb');

const wallets = [];

async function printBalances(label) {
  console.log(`\n=== ${label} ===`);
  const [walletA, walletB, walletC] = wallets;
  return Promise.all([
    walletA.getBalance(),
    walletB.getBalance(),
    walletC.getBalance(),
  ]).then(([balanceA, balanceB, balanceC]) => {
    console.log('Wallet A Balance:', balanceA);
    console.log('Wallet B Balance:', balanceB);
    console.log('Wallet C Balance:', balanceC);
  });
}

async function mineBlocks(n, addr) {
  addr = addr ? addr : new Address().toString('regtest');
  for (let i = 0; i < n; i++) {
    const block = await node.miner.mineBlock(null, addr);
    await node.chain.add(block);
  }
}

describe('Test balance after name transfer', function () {
  before(async function () {
    await node.open();
    await wclient.open();

    for (let i = 0; i < 3; i++) {
      const wallet = await wdb.create();
      wallets.push(wallet);
    }
  });
  after(async () => {
    await wclient.close();
    await node.close();
  });

  it('should fund all wallets', async function () {
    for (const wallet of wallets) {
      const receive = await wallet.receiveAddress();
      await mineBlocks(1, receive);

      const balance = await wallet.getBalance();
      assert.strictEqual(balance.confirmed, 2000_000000);
    }
  });

  it('should not keep coins locked', async function () {
    const [walletA, walletB, walletC] = wallets;
    const name = rules.grindName(5, 1, network);

    const BID_WIN = {
      BLIND: 64_000000,
      AMOUNT: 32_000000,
    };
    const BID_SEC = {
      BLIND: 16_000000,
      AMOUNT: 8_000000,
    };

    await printBalances('Before auction');

    await walletA.sendOpen(name);
    await mineBlocks(treeInterval + 2);

    await printBalances('After opening auction');

    await walletA.sendBid(name, BID_WIN.AMOUNT, BID_WIN.BLIND);
    await walletB.sendBid(name, BID_SEC.AMOUNT, BID_SEC.BLIND);

    await mineBlocks(biddingPeriod + 1);
    await printBalances('After bidding');

    await walletA.sendReveal(name);
    await walletB.sendReveal(name);

    await mineBlocks(revealPeriod + 1);
    await printBalances('After reveal');

    await walletA.sendUpdate(
      name,
      Resource.fromJSON({
        records: [
          {
            type: 'TXT',
            txt: ['Some data'],
          },
        ],
      })
    );
    await walletB.sendRedeem(name);

    await mineBlocks(3);
    await printBalances('After update and redeem');

    const addrC = await walletC.receiveAddress();
    await walletA.sendTransfer(name, addrC);

    await mineBlocks(transferLockup + 1);
    await printBalances('After transfer lockup');

    await walletA.sendFinalize(name);
    await mineBlocks(1);
    await printBalances('After finalize');
  });
});
