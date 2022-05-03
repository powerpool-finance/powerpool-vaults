require('@nomiclabs/hardhat-truffle5');
require('@nomiclabs/hardhat-ethers');

task('deploy-lusd-asset-manager', 'Deploy LUSD Asset Manager').setAction(async (__, { ethers, network }) => {
  const { ether, zeroAddress, impersonateAccount, gwei, increaseTime } = require('../test/helpers');
  const IERC20 = await artifacts.require('@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20');
  const IVault = await artifacts.require('contracts/interfaces/balancerV3/IVault.sol:IVault');
  const MockERC20 = await artifacts.require('MockERC20');
  const AssetManager = await artifacts.require('AssetManager');
  const PowerPoke = await artifacts.require('PowerPoke');
  const IAuthorizer = await artifacts.require('contracts/interfaces/balancerV3/IAuthorizer.sol:IAuthorizer');
  const IBasePool = await artifacts.require('contracts/interfaces/balancerV3/IBasePool.sol:IBasePool');
  const BAMM = await artifacts.require('BAMM');
  const StabilityPool = await artifacts.require('StabilityPool');
  const BProtocolPowerIndexConnector = await artifacts.require('BProtocolPowerIndexConnector');
  const StablePoolFactory = await artifacts.require('@powerpool/balancer-v2-pool-stable/contracts/StablePoolFactory');

  const { web3 } = IERC20;

  const [deployer] = await web3.eth.getAccounts();

  if (network.name === 'mainnetfork') {
    await network.provider.request({
      method: 'hardhat_reset',
      params: [{ forking: { jsonRpcUrl: process.env.RPC } }],
    });
    const daoMultisigAddress = '0x10a19e7ee7d7f8a52822f6817de8ea18204f2e4f';
    const roles = ['0x38850d48acdf7da1f77e6b4a1991447eb2c439554ba14cdfec945500fdc714a1'];
    const authorizer = await IAuthorizer.at('0xa331d84ec860bf466b4cdccfb4ac09a1b43f3ae6');
    await impersonateAccount(ethers, daoMultisigAddress);
    await authorizer.grantRoles(roles, deployer, { from: daoMultisigAddress });
  }

  const OWNER = '0xB258302C3f209491d604165549079680708581Cc';
  const vaultAddress = '0xba12222222228d8ba445958a75a0704d566bf2c8';
  const lusdAddress = '0x5f98805a4e8be255a32880fdec7f6728c6568ba0';
  const lqtyAddress = '0x6dea81c8171d0ba574754ef6f8b412f2ed88c54d';
  const bammAddress = '0x00ff66ab8699aafa050ee5ef5041d1503aa0849a';
  const stabilityPoolAddress = '0x66017d22b0f8556afdd19fc67041899eb65a21bb';

  const bbaUSDAddress = '0x7b50775383d3d6f0215a8f290f2c9e2eebbeceb2';

  const stablePoolFactory = await StablePoolFactory.new(vaultAddress);

  const assetManager = await AssetManager.new(vaultAddress, lusdAddress, {
    poolRestrictions: '0x698967cA2fB85A6D9a7D2BeD4D2F6D32Bbc5fCdc',
    powerPoke: '0x04D7aA22ef7181eE3142F5063e026Af1BbBE5B96',
    reserveRatio: ether(0.1),
    reserveRatioLowerBound: ether(0.01),
    reserveRatioUpperBound: ether(0.2),
    claimRewardsInterval: '3600',
    performanceFeeReceiver: '0xd132973eaebbd6d7ca7b88e9170f2cca058de430',
    performanceFee: ether(0.003),
  });

  const lusd = await IERC20.at(lusdAddress);
  const bbaUSD = await IERC20.at(bbaUSDAddress);
  const vault = await IVault.at(vaultAddress);

  const lusdHolder = '0x99c9fc46f92e8a1c0dec1b1747d010903e884be1';
  const bbausdHolder = '0x9888e846bcb0a14e0fcb2f66368a69d1d04bd5f0';
  await impersonateAccount(ethers, lusdHolder);
  await impersonateAccount(ethers, bbausdHolder);
  await lusd.transfer(deployer, ether(2e6), { from: lusdHolder });
  await bbaUSD.transfer(deployer, ether(2e6), { from: bbausdHolder });

  const lusdSecond = web3.utils.toBN(lusdAddress).gt(web3.utils.toBN(ausd.address));
  let res = await stablePoolFactory.create(
    'Balancer PP Stable Pool',
    'bb-p-USD',
    lusdSecond ? [bbaUSD.address, lusdAddress] : [lusdAddress, bbaUSD.address],
    lusdSecond ? [zeroAddress, assetManager.address] : [assetManager.address, zeroAddress],
    200,
    5e14,
    deployer,
  );

  const pool = await IBasePool.at(res.receipt.logs[0].args.pool);

  await assetManager.setAssetsHolder(vaultAddress);

  // borrowerOperations.openTrove(
  //   ether(1),
  //   ether(5e6),
  //   zeroAddress,
  //   zeroAddress,
  //   {value : ether(4e3)}
  // );

  // assertEq(IERC20(liquity.lusd()).balanceOf(DEPLOYER), 5e6 ether);

  await ausd.approve(vaultAddress, ether(2e6));
  await lusd.approve(vaultAddress, ether(2e6));

  // assertEq(IERC20(ausd).balanceOf(DEPLOYER), 1e9 ether);
  // assertEq(IERC20(lusd).balanceOf(DEPLOYER), 5e6 ether);

  await vault.joinPool(await pool.getPoolId(), deployer, deployer, {
    assets: lusdSecond ? [ausd.address, lusdAddress] : [lusdAddress, ausd.address],
    maxAmountsIn: [ether(2e6), ether(2e6)],
    userData: web3.eth.abi.encodeParameters(['uint256', 'uint256[]'], [0, [ether(2e6), ether(2e6)]]),
    fromInternalBalance: false,
  });

  const connector = await BProtocolPowerIndexConnector.new(
    assetManager.address,
    bammAddress,
    lusd.address,
    vaultAddress,
    stabilityPoolAddress,
    lqtyAddress,
    await pool.getPoolId(),
  );
  await assetManager.setConnectorList([
    {
      connector: connector.address,
      share: ether(1),
      callBeforeAfterPoke: false,
      newConnector: true,
      connectorIndex: 0,
    },
  ]);

  console.log('vault.getPoolTokenInfo', await vault.getPoolTokenInfo(await pool.getPoolId(), lusd.address));
  console.log('connector.address', connector.address);
  console.log('assetManager.address', assetManager.address);

  await assetManager.initRouterByConnector('0', '0x');
  await assetManager.transferOwnership(OWNER);

  if (network.name !== 'mainnetfork') {
    return;
  }

  const pokerReporter = '0xabdf215fce6c5b0c1b40b9f2068204a9e7c49627';
  const BONUS_NUMERATOR = '7610350076';
  const BONUS_DENUMERATOR = '10000000000000000';
  const MIN_REPORT_INTERVAL = 60 * 60 * 24 * 14;
  const MAX_REPORT_INTERVAL = MIN_REPORT_INTERVAL + 60 * 60;
  const MAX_GAS_PRICE = gwei(500);
  const PER_GAS = '10000';
  const MIN_SLASHING_DEPOSIT = ether(40);

  await impersonateAccount(ethers, OWNER);

  const powerPokeAddress = '0x04D7aA22ef7181eE3142F5063e026Af1BbBE5B96';
  const cvpAddress = '0x38e4adb44ef08f22f5b5b76a8f0c2d0dcbe7dca1';
  const powerPoke = await PowerPoke.at(powerPokeAddress);
  await powerPoke.addClient(
    assetManager.address,
    OWNER,
    true,
    MAX_GAS_PRICE,
    MIN_REPORT_INTERVAL,
    MAX_REPORT_INTERVAL,
    { from: OWNER },
  );
  await powerPoke.setMinimalDeposit(assetManager.address, MIN_SLASHING_DEPOSIT, { from: OWNER });
  await powerPoke.setBonusPlan(assetManager.address, '1', true, BONUS_NUMERATOR, BONUS_DENUMERATOR, PER_GAS, {
    from: OWNER,
  });
  await powerPoke.setFixedCompensations(assetManager.address, 200000, 60000, { from: OWNER });

  const cvp = await IERC20.at(cvpAddress);
  await cvp.approve(powerPoke.address, ether(10000), { from: OWNER });
  await powerPoke.addCredit(assetManager.address, ether(10000), { from: OWNER });

  const powerPokeOpts = web3.eth.abi.encodeParameter(
    { PowerPokeRewardOpts: { to: 'address', compensateInETH: 'bool' } },
    { to: pokerReporter, compensateInETH: true },
  );

  await impersonateAccount(ethers, pokerReporter);

  const bamm = await BAMM.at(bammAddress);
  console.log('stability pool', await bamm.SP());
  const stabilityPool = await StabilityPool.at(await bamm.SP());
  console.log(
    'getCompoundedLUSDDeposit',
    await stabilityPool.getCompoundedLUSDDeposit(bammAddress).then(r => r.toString()),
  );
  console.log('getDepositorETHGain', await stabilityPool.getDepositorETHGain(bammAddress).then(r => r.toString()));
  console.log('fetchPrice', await bamm.fetchPrice().then(r => r.toString()));

  let printsNumber = 0;
  async function printState() {
    console.log('\n');
    printsNumber++;
    console.log(printsNumber + ' getUnderlyingReserve', await connector.getUnderlyingReserve().then(r => r.toString()));
    console.log(printsNumber + ' getUnderlyingManaged', await connector.getUnderlyingManaged().then(r => r.toString()));
    console.log(printsNumber + ' getUnderlyingStaked ', await connector.getUnderlyingStaked().then(r => r.toString()));
    console.log(printsNumber + ' getPendingRewards   ', await connector.getPendingRewards().then(r => r.toString()));
  }

  const bammDepositer = '0xf35da7a42d92c7919172195aa7bc7a0d43ec866c';
  await impersonateAccount(ethers, bammDepositer);

  await assetManager.setClaimParams('0', await connector.packClaimParams(ether('10')), { from: OWNER });
  await assetManager.setStakeParams('0', await connector.packStakeParams(ether('0.1'), ether('10000')), {
    from: OWNER,
  });

  await printState();
  await assetManager.pokeFromReporter('1', false, powerPokeOpts, { from: pokerReporter });
  await printState();
  await increaseTime(60 * 60);
  await bamm.withdraw('0', { from: bammDepositer });
  await printState();
  await increaseTime(60 * 60);
  await bamm.withdraw('0', { from: bammDepositer });
  await printState();
  console.log('stake 1', await bamm.stake(assetManager.address).then(a => a.toString()));
  console.log('isClaimAvailable', await connector.isClaimAvailable(await connector.packClaimParams(ether('10'))));
  console.log(
    'getStakeAndClaimStatusByConnectorIndex',
    await assetManager.getStakeAndClaimStatusByConnectorIndex('0', true),
  );
  await assetManager.pokeFromReporter('1', true, powerPokeOpts, { from: pokerReporter });
  console.log('stake 2', await bamm.stake(assetManager.address).then(a => a.toString()));
  // await increaseTime(MIN_REPORT_INTERVAL);
  // await assetManager.pokeFromReporter('1', false, powerPokeOpts, {from: pokerReporter});
});
