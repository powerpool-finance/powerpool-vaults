require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');

task('redeploy-torn-router', 'Redeploy TornRouter').setAction(async (__, {ethers, network}) => {
  const {ether, fromEther, impersonateAccount, increaseTime, advanceBlocks} = require('../test/helpers');
  const WrappedPiErc20 = await artifacts.require('WrappedPiErc20');
  const IERC20 = await artifacts.require('WrappedPiErc20');
  const PowerIndexRouter = await artifacts.require('PowerIndexRouter');
  const TornPowerIndexConnector = await artifacts.require('TornPowerIndexConnector');

  if (process.env.FORK) {
    await ethers.provider.send('hardhat_reset', [{forking: {jsonRpcUrl: process.env.FORK}}]);
  }

  const { web3 } = WrappedPiErc20;

  const [deployer] = await web3.eth.getAccounts();
  console.log('deployer', deployer);
  const OWNER = '0xB258302C3f209491d604165549079680708581Cc';
  const piTornAddress = '0xa1ebc8bde2f1f87fe24f384497b6bd9ce3b14345';
  const TORN_STAKING = '0x2fc93484614a34f26f7970cbb94615ba109bb4bf';
  const TORN_GOVERNANCE = '0x5efda50f22d34f262c29268506c5fa42cb56a1ce';
  const tornAddress = '0x77777feddddffc19ff86db637967013e6c6a116c';

  const startBalance = fromEther(await web3.eth.getBalance(deployer));
  const tornRouter = await PowerIndexRouter.at('0xDAf584C15722cdc7E78214Fb1A4832dA6638D655');
  console.log('tornRouter', tornRouter.address);
  const piTorn = await WrappedPiErc20.at(piTornAddress);
  const tornConnector = await TornPowerIndexConnector.new(TORN_STAKING, tornAddress, piTorn.address, TORN_GOVERNANCE);
  console.log('tornConnector', tornConnector.address);

  console.log('tornConnector done');

  const endBalance = fromEther(await web3.eth.getBalance(deployer));
  console.log('balance spent', startBalance - endBalance);
  if (network.name !== 'mainnetfork') {
    return;
  }

  await impersonateAccount(ethers, OWNER);
  await tornRouter.initRouterByConnector('0', '0x', {from: OWNER});
  await tornRouter.setConnectorList([
    {
      connector: tornConnector.address,
      share: ether(1),
      callBeforeAfterPoke: false,
      newConnector: false,
      connectorIndex: 0,
    },
  ], {from: OWNER});

  const ITornGovernance = await artifacts.require('ITornGovernance');
  const ITornStaking = await artifacts.require('ITornStaking');

  const torn = await IERC20.at('0x77777feddddffc19ff86db637967013e6c6a116c');

  const tornHolder = '0xf977814e90da44bfa03b6295a0616a897441acec';
  const pokerReporter = '0xabdf215fce6c5b0c1b40b9f2068204a9e7c49627';
  await impersonateAccount(ethers, tornHolder);
  const amount = ether(	33400);
  console.log('1 wrapper balance', fromEther(await torn.balanceOf(piTorn.address)));
  await torn.approve(piTorn.address, amount, {from: tornHolder});
  await piTorn.deposit(amount, {from: tornHolder});
  console.log('2 wrapper balance', fromEther(await torn.balanceOf(piTorn.address)));

  const powerPokeOpts = web3.eth.abi.encodeParameter(
    { PowerPokeRewardOpts: {to: 'address', compensateInETH: 'bool'} },
    {to: pokerReporter, compensateInETH: true},
  );

  await impersonateAccount(ethers, pokerReporter);

  // await tornRouter.pokeFromReporter('1', false, powerPokeOpts, {from: pokerReporter});

  console.log('3 wrapper balance', fromEther(await torn.balanceOf(piTorn.address)));
  const governance = await ITornGovernance.at(TORN_GOVERNANCE);
  const staking = await ITornStaking.at(TORN_STAKING);
  console.log('lockedBalance', fromEther(await governance.lockedBalance(piTorn.address)));
  console.log('checkReward 1', fromEther(await staking.checkReward(piTorn.address)));

  const TEN_HOURS = 60 * 60 * 10;
  const GAS_TO_REINVEST = '100000';
  await impersonateAccount(ethers, TORN_GOVERNANCE);

  await tornRouter.setClaimParams('0', await getClaimParams(TEN_HOURS), {from: OWNER});

  await increaseTime(TEN_HOURS);
  await advanceBlocks(1);
  await staking.addBurnRewards(ether(1700), {from: TORN_GOVERNANCE});
  console.log('checkReward 2', fromEther(await staking.checkReward(piTorn.address)));
  await printForecast(TEN_HOURS);
  await checkClaimAvailability(TEN_HOURS);

  await increaseTime(TEN_HOURS);
  await advanceBlocks(1);
  await staking.addBurnRewards(ether(2700), {from: TORN_GOVERNANCE});
  console.log('checkReward 3', fromEther(await staking.checkReward(piTorn.address)));
  await printForecast(TEN_HOURS);
  await checkClaimAvailability(TEN_HOURS);

  const res = await tornRouter.pokeFromReporter('1', true, powerPokeOpts, {from: pokerReporter});
  console.log('res.receipt.gasUsed', res.receipt.gasUsed);

  console.log('lockedBalance', fromEther(await governance.lockedBalance(piTorn.address)));

  await torn.approve(piTorn.address, amount, {from: tornHolder});
  await piTorn.deposit(amount, {from: tornHolder});

  console.log('lockedBalance after deposit', fromEther(await governance.lockedBalance(piTorn.address)));

  function getClaimParams(duration) {
    return tornConnector.packClaimParams(duration, GAS_TO_REINVEST);
  }
  async function checkClaimAvailability(duration) {
    const connector = await tornRouter.connectors('0');
    const claimParams = await getClaimParams(duration);
    const res = await tornConnector.isClaimAvailable(claimParams, connector.lastClaimRewardsAt, connector.lastChangeStakeAt);
    const tornNeedToReinvest = await tornConnector.getTornUsedToReinvest(GAS_TO_REINVEST, parseInt(process.env.GAS_PRICE) * 10 ** 9);
    console.log('tornNeedToReinvest', fromEther(tornNeedToReinvest));
    console.log('isClaimAvailable for', parseInt(duration) / (60 * 60), 'hours:', res);
    return res;
  }

  async function printForecast(investDuration) {
    const block = await web3.eth.getBlock('latest');
    const connector = await tornRouter.connectors('0');
    let {lastClaimRewardsAt, lastChangeStakeAt} = connector;
    lastClaimRewardsAt = parseInt(lastClaimRewardsAt.toString(10));
    lastChangeStakeAt = parseInt(lastChangeStakeAt.toString(10));
    const lastRewardsAt = lastClaimRewardsAt > lastChangeStakeAt ? lastClaimRewardsAt : lastChangeStakeAt;

    console.log('forecast after', (block.timestamp - lastRewardsAt) / (60 * 60), 'hours:', fromEther(await tornConnector.getPendingAndForecastReward(
      lastClaimRewardsAt,
      lastChangeStakeAt,
      investDuration
    ).then(r => r.forecastByPending)), 'with invest duration', investDuration / (60 * 60), 'hours');
  }
});
