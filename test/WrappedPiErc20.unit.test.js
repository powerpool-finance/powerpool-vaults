const { expectEvent, expectRevert, constants } = require('@openzeppelin/test-helpers');
const { buildBasicRouterConfig } = require('./helpers/builders');
const { ether, expectExactRevert, splitPayload, toEvmBytes32  } = require('./helpers');
const assert = require('chai').assert;
const MockERC20 = artifacts.require('MockERC20');
const WrappedPiErc20 = artifacts.require('WrappedPiErc20');
const MockRouter = artifacts.require('MockRouter');
const MyContract = artifacts.require('MyContract');
const MockPoke = artifacts.require('MockPoke');

MyContract.numberFormat = 'String';
MockERC20.numberFormat = 'String';
WrappedPiErc20.numberFormat = 'String';
MockRouter.numberFormat = 'String';

const { web3 } = MockERC20;

function signatureAndArgs(payload) {
  assert(payload.length > 11, 'Payload too small');
  return {
    signature: payload.substr(0, 10),
    args: `0x${payload.substr(10, payload.length - 1)}`,
  };
}

describe('WrappedPiErc20 Unit Tests', () => {
  let deployer, alice, bob, stub, mockStaking;
  let cake, router, piCake, myContract, defaultBasicConfig;

  beforeEach(async function () {
    [deployer, alice, bob, stub, mockStaking] = await web3.eth.getAccounts();
    myContract = await MyContract.new();
    const poke = await MockPoke.new(true);
    defaultBasicConfig = buildBasicRouterConfig(
      stub,
      poke.address,
      constants.ZERO_ADDRESS,
      constants.ZERO_ADDRESS,
      ether('0.2'),
      ether('0.02'),
      ether('0.3'),
      '0',
      stub,
      ether(0),
      []
    );

    cake = await MockERC20.new('CAKE', 'CAKE', 18, ether('1000000'));
    piCake = await WrappedPiErc20.new(cake.address, stub, 'WrappedPiCAKE', 'piCAKE');
    router = await MockRouter.new(piCake.address, defaultBasicConfig);
    await piCake.changeRouter(router.address, { from: stub });
    await cake.transfer(mockStaking, ether(50));
  });

  it('should initialize correctly', async () => {
    assert.equal(await piCake.name(), 'WrappedPiCAKE');
    assert.equal(await piCake.symbol(), 'piCAKE');
    assert.equal(await piCake.underlying(), cake.address);
    assert.equal(await piCake.router(), router.address);
    assert.equal(await piCake.totalSupply(), 0);
  });

  describe('callExternal', async () => {
    beforeEach(async () => {
      await router.migrateToNewRouter(piCake.address, alice, []);
    });

    it('should call the external methods', async () => {
      await myContract.transferOwnership(piCake.address);
      const payload = splitPayload(myContract.contract.methods.setAnswer(42).encodeABI());

      assert.equal(await myContract.getAnswer(), 0);
      const res = await piCake.callExternal(myContract.address, payload.signature, payload.calldata, 0, {
        from: alice,
      });
      assert.equal(await myContract.getAnswer(), 42);
      expectEvent(res, 'CallExternal', {
        destination: myContract.address,
        inputSig: toEvmBytes32(payload.signature),
        inputData: payload.calldata,
        outputData: '0x000000000000000000000000000000000000000000000000000000000000007b',
      });
    });

    it('should call the multiple external methods', async () => {
      await myContract.transferOwnership(piCake.address);
      const payload = splitPayload(myContract.contract.methods.setAnswer(42).encodeABI());
      const payload2 = splitPayload(myContract.contract.methods.setAnswer2(24).encodeABI());

      assert.equal(await myContract.getAnswer(), 0);
      await piCake.callExternalMultiple([{
        destination: myContract.address,
        signature: payload.signature,
        args: payload.calldata,
        value: 0,
      },{
        destination: myContract.address,
        signature: payload2.signature,
        args: payload2.calldata,
        value: 0,
      }], {
        from: alice,
      });
      assert.equal(await myContract.getAnswer(), 42);
      assert.equal(await myContract.getAnswer2(), 24);
    });

    it('should deny non-router calling the method', async () => {
      const payload = splitPayload(myContract.contract.methods.setAnswer(42).encodeABI());

      await expectExactRevert(
        piCake.callExternal(myContract.address, payload.signature, payload.calldata, 0, { from: alice }),
        'Ownable: caller is not the owner',
      );

      await expectExactRevert(
        piCake.callExternalMultiple([{
          destination: myContract.address,
          signature: payload.signature,
          args: payload.calldata,
          value: 0,
        }], { from: alice }),
        'Ownable: caller is not the owner',
      );
    });

    it('should use default revert message for an empty returndata', async () => {
      const data = myContract.contract.methods.revertWithoutString().encodeABI();
      await expectExactRevert(
        piCake.callExternal(myContract.address, data, '0x', 0, { from: alice }),
        'REVERTED_WITH_NO_REASON_STRING',
      );
    });

    it('should use the response revert message when reverting', async () => {
      const data = myContract.contract.methods.revertWithString().encodeABI();
      await expectExactRevert(
        piCake.callExternal(myContract.address, data, '0x', 0, { from: alice }),
        'some-unique-revert-string',
      );
    });

    it('should use a long response revert message when reverting', async () => {
      const data = myContract.contract.methods.revertWithLongString().encodeABI();
      await expectExactRevert(
        piCake.callExternal(myContract.address, data, '0x', 0, { from: alice }),
        'some-unique-revert-string-that-is-a-bit-longer-than-a-single-evm-slot',
      );
    });

    it('should use default revert message when getting invalid opcode', async () => {
      const data = myContract.contract.methods.invalidOp().encodeABI();
      await expectExactRevert(
        piCake.callExternal(myContract.address, data, '0x', 0, { from: alice }),
        'REVERTED_WITH_NO_REASON_STRING',
      );
    });
  });

  describe('deposit', async () => {
    beforeEach(async () => {
      await cake.transfer(alice, ether('10000'));
    });

    it('should mint the same token amount that was deposited for a balanced wrapper', async () => {
      assert.equal(await cake.balanceOf(alice), ether(10000));
      assert.equal(await cake.balanceOf(piCake.address), ether(0));

      await cake.approve(piCake.address, ether(42), { from: alice });
      const res = await piCake.deposit(ether(42), { from: alice });

      expectEvent(res, 'Deposit', {
        account: alice,
        undelyingDeposited: ether(42),
        piMinted: ether(42),
      });

      assert.equal(await cake.balanceOf(alice), ether(9958));
      assert.equal(await cake.balanceOf(piCake.address), ether(42));

      assert.equal(await piCake.totalSupply(), ether(42));
      assert.equal(await piCake.balanceOf(alice), ether(42));
    });

    it('should call the router callback with 0', async () => {
      await cake.approve(piCake.address, ether(42), { from: alice });
      const res = await piCake.deposit(ether(42), { from: alice });
      await expectEvent.inTransaction(res.tx, MockRouter, 'MockWrapperCallback', {
        withdrawAmount: '0',
      });
    });

    it('should revert if there isn not enough approval', async () => {
      await expectRevert(piCake.deposit(ether(42), { from: alice }), 'ERC20: transfer amount exceeds allowance');
    });

    it('should deny depositing 0', async () => {
      await expectRevert(piCake.deposit(ether(0), { from: alice }), 'ZERO_DEPOSIT');
    });

    it('should take fee if set', async () => {
      assert.equal(await piCake.ethFee(), ether(0));

      const ethFee = ether(0.001);

      await router.setPiTokenEthFee(ethFee, { from: deployer });

      assert.equal(await piCake.ethFee(), ethFee);

      await cake.approve(piCake.address, ether(42), { from: alice });
      await expectRevert(piCake.deposit(ether(42), { from: alice }), 'FEE');

      assert.equal(await web3.eth.getBalance(router.address), 0);

      const res = await piCake.deposit(ether(42), { from: alice, value: ethFee });

      expectEvent(res, 'Deposit', {
        account: alice,
        undelyingDeposited: ether(42),
        piMinted: ether(42),
      });

      assert.equal(await cake.balanceOf(alice), ether(9958));
      assert.equal(await cake.balanceOf(piCake.address), ether(42));

      assert.equal(await piCake.totalSupply(), ether(42));
      assert.equal(await piCake.balanceOf(alice), ether(42));

      assert.equal(await web3.eth.getBalance(piCake.address), 0);
      assert.equal(await web3.eth.getBalance(router.address), ethFee);
    });

    it('should ignore fee for the whitelisted addresses', async () => {
      assert.equal(await piCake.ethFee(), ether(0));

      const ethFee = ether(0.001);

      await router.setPiTokenEthFee(ethFee, { from: deployer });
      await router.setPiTokenNoFee(alice, true, { from: deployer });

      assert.equal(await piCake.ethFee(), ethFee);

      await cake.approve(piCake.address, ether(42), { from: alice });
      await expectRevert(piCake.deposit(ether(42), { from: alice, value: ethFee }), 'NO_FEE_FOR_WL');
      const res = await piCake.deposit(ether(42), { from: alice });

      expectEvent(res, 'Deposit', {
        account: alice,
        undelyingDeposited: ether(42),
        piMinted: ether(42),
      });
    });

    describe('imbalanced router', () => {
      beforeEach(async () => {
        assert.equal(await cake.balanceOf(alice), ether(10000));
        assert.equal(await cake.balanceOf(bob), ether(0));

        assert.equal(await cake.balanceOf(piCake.address), ether(0));
        assert.equal(await piCake.totalSupply(), ether(0));
      });

      it('should mint greater pi amount for a negatively imbalanced router', async () => {
        // Drain 200 yfi from the wrapper token
        await cake.approve(piCake.address, ether(1200), { from: alice });
        await piCake.deposit(ether(1200), { from: alice });
        await router.drip(stub, ether(200));
        assert.equal(await cake.balanceOf(piCake.address), ether(1000));
        assert.equal(await piCake.totalSupply(), ether(1200));
        assert.equal(await cake.balanceOf(piCake.address), await piCake.totalSupplyUnderlying());

        const underlyingDeposit = ether(100);
        const piEquivalent = ether(120);
        await cake.transfer(bob, underlyingDeposit, { from: alice });

        // Deposit
        await cake.approve(piCake.address, underlyingDeposit, { from: bob });
        const res = await piCake.deposit(underlyingDeposit, { from: bob });

        expectEvent(res, 'Deposit', {
          account: bob,
          undelyingDeposited: underlyingDeposit,
          piMinted: piEquivalent,
        });

        assert.equal(await cake.balanceOf(bob), ether(0));
        assert.equal(await cake.balanceOf(piCake.address), ether(1100));

        assert.equal(await cake.balanceOf(piCake.address), await piCake.totalSupplyUnderlying());
        assert.equal(await piCake.totalSupply(), ether(1320));
        assert.equal(await piCake.balanceOf(bob), piEquivalent);
        assert.equal(await piCake.balanceOfUnderlying(bob), underlyingDeposit);
      });

      it('should mint smaller pi amount for a positively imbalanced router', async () => {
        // Add 400 extra yfi to the wrapper
        await cake.approve(piCake.address, ether(1000), { from: alice });
        await piCake.deposit(ether(1000), { from: alice });
        await cake.transfer(piCake.address, ether(600), { from: alice });
        assert.equal(await cake.balanceOf(piCake.address), ether(1600));
        assert.equal(await piCake.totalSupply(), ether(1000));
        assert.equal(await cake.balanceOf(piCake.address), await piCake.totalSupplyUnderlying());
        await cake.transfer(bob, ether(100), { from: alice });

        // Deposit
        const underlyingDeposit = ether(100);
        const piEquivalent = ether(62.5);
        await cake.approve(piCake.address, underlyingDeposit, { from: bob });
        const res = await piCake.deposit(underlyingDeposit, { from: bob });

        expectEvent(res, 'Deposit', {
          account: bob,
          undelyingDeposited: underlyingDeposit,
          piMinted: piEquivalent,
        });

        assert.equal(await cake.balanceOf(bob), ether(0));
        assert.equal(await cake.balanceOf(piCake.address), ether(1700));

        assert.equal(await cake.balanceOf(piCake.address), await piCake.totalSupplyUnderlying());
        assert.equal(await piCake.totalSupply(), ether(1062.5));
        assert.equal(await piCake.balanceOf(bob), piEquivalent);
        assert.equal(await piCake.balanceOfUnderlying(bob), underlyingDeposit);
      });
    });
  });

  describe('withdraw', async () => {
    beforeEach(async () => {
      await cake.transfer(alice, ether('10000'));
    });

    describe('balanced wrapper', () => {
      beforeEach(async () => {
        await cake.approve(piCake.address, ether(42), { from: alice });
        await piCake.deposit(ether(42), { from: alice });
      });

      it('should charge the same token amount that was returned', async () => {
        assert.equal(await cake.balanceOf(alice), ether(9958));
        assert.equal(await cake.balanceOf(piCake.address), ether(42));
        assert.equal(await piCake.balanceOf(alice), ether(42));

        const res = await piCake.withdraw(ether(42), { from: alice });

        expectEvent(res, 'Withdraw', {
          account: alice,
          underlyingWithdrawn: ether(42),
          piBurned: ether(42),
        });

        assert.equal(await cake.balanceOf(alice), ether(10000));
        assert.equal(await cake.balanceOf(piCake.address), ether(0));

        assert.equal(await piCake.totalSupply(), ether(0));
        assert.equal(await piCake.balanceOf(alice), ether(0));
      });

      it('should call the router callback with the returned amount', async () => {
        const res = await piCake.withdraw(ether(42), { from: alice });
        await expectEvent.inTransaction(res.tx, MockRouter, 'MockWrapperCallback', {
          withdrawAmount: ether(42),
        });
      });

      it('should revert if there isn not enough balance', async () => {
        await expectRevert(piCake.withdraw(ether(43), { from: alice }), 'ERC20: burn amount exceeds balance');
      });

      it('should deny withdrawing 0', async () => {
        await expectRevert(piCake.withdraw(ether(0), { from: alice }), 'ZERO_WITHDRAWAL');
      });

      it('should take fee if set', async () => {
        assert.equal(await piCake.ethFee(), ether(0));

        const ethFee = ether(0.001);

        await router.setPiTokenEthFee(ethFee, { from: deployer });

        assert.equal(await piCake.ethFee(), ethFee);

        assert.equal(await web3.eth.getBalance(router.address), 0);

        await expectRevert(piCake.withdraw(ether(42), { from: alice }), 'FEE');

        const res = await piCake.withdraw(ether(42), { from: alice, value: ethFee });
        expectEvent(res, 'Withdraw', {
          account: alice,
          underlyingWithdrawn: ether(42),
          piBurned: ether(42),
        });

        assert.equal(await cake.balanceOf(alice), ether(10000));
        assert.equal(await cake.balanceOf(piCake.address), ether(0));

        assert.equal(await piCake.totalSupply(), ether(0));
        assert.equal(await piCake.balanceOf(alice), ether(0));

        assert.equal(await web3.eth.getBalance(router.address), ethFee);
        assert.equal(await web3.eth.getBalance(piCake.address), 0);
      });

      it('should ignore fee for the whitelisted addresses', async () => {
        assert.equal(await piCake.ethFee(), ether(0));

        const ethFee = ether(0.001);

        await router.setPiTokenEthFee(ethFee, { from: deployer });
        await router.setPiTokenNoFee(alice, true, { from: deployer });

        assert.equal(await piCake.ethFee(), ethFee);

        await expectRevert(piCake.withdraw(ether(42), { from: alice, value: ethFee }), 'NO_FEE_FOR_WL');

        const res = await piCake.withdraw(ether(42), { from: alice });
        expectEvent(res, 'Withdraw', {
          account: alice,
          underlyingWithdrawn: ether(42),
          piBurned: ether(42),
        });
      });
    });

    describe('imbalanced wrapper', () => {
      beforeEach(async () => {
        assert.equal(await cake.balanceOf(bob), ether(0));
      });

      it('should burn greater pi amount for a negatively imbalanced router', async () => {
        await cake.approve(piCake.address, ether(1200), { from: alice });
        await piCake.deposit(ether(1200), { from: alice });
        // Drain 200 yfi from the wrapper token
        await router.drip(stub, ether(200));
        assert.equal(await cake.balanceOf(piCake.address), ether(1000));
        assert.equal(await piCake.totalSupply(), ether(1200));
        await piCake.transfer(bob, ether(120), { from: alice });

        // Withdraw
        const res = await piCake.withdraw(ether(100), { from: bob });

        expectEvent(res, 'Withdraw', {
          account: bob,
          underlyingWithdrawn: ether(100),
          piBurned: ether(120),
        });

        assert.equal(await cake.balanceOf(bob), ether(100));
        assert.equal(await cake.balanceOf(piCake.address), ether(900));

        assert.equal(await piCake.totalSupply(), ether(1080));
        assert.equal(await piCake.balanceOf(bob), ether(0));
      });

      it('should burn smaller pi amount for a positively imbalanced router', async () => {
        await cake.approve(piCake.address, ether(1000), { from: alice });
        await piCake.deposit(ether(1000), { from: alice });
        await cake.transfer(piCake.address, ether(600), { from: alice });
        assert.equal(await cake.balanceOf(piCake.address), ether(1600));
        assert.equal(await piCake.totalSupply(), ether(1000));
        await piCake.transfer(bob, ether(62.5), { from: alice });

        // Withdraw
        const res = await piCake.withdraw(ether(100), { from: bob });

        expectEvent(res, 'Withdraw', {
          account: bob,
          underlyingWithdrawn: ether(100),
          piBurned: ether(62.5),
        });

        assert.equal(await cake.balanceOf(bob), ether(100));
        assert.equal(await cake.balanceOf(piCake.address), ether(1500));

        assert.equal(await piCake.totalSupply(), ether(937.5));
        assert.equal(await piCake.balanceOf(bob), ether(0));
      });

      it('should allow draining a negatively imbalanced router', async () => {
        await cake.approve(piCake.address, ether(200), { from: alice });
        await piCake.deposit(ether(200), { from: alice });
        await router.drip(stub, ether(100));
        assert.equal(await cake.balanceOf(piCake.address), ether(100));
        assert.equal(await piCake.totalSupply(), ether(200));

        await piCake.transfer(bob, ether(200), { from: alice });

        // Withdraw
        const res = await piCake.withdraw(ether(100), { from: bob });

        expectEvent(res, 'Withdraw', {
          account: bob,
          underlyingWithdrawn: ether(100),
          piBurned: ether(200),
        });

        assert.equal(await cake.balanceOf(bob), ether(100));
        assert.equal(await cake.balanceOf(piCake.address), ether(0));

        assert.equal(await piCake.totalSupply(), ether(0));
        assert.equal(await piCake.balanceOf(bob), ether(0));
      });

      it('should allow draining a positively imbalanced router', async () => {
        await cake.approve(piCake.address, ether(100), { from: alice });
        await piCake.deposit(ether(100), { from: alice });
        await cake.transfer(piCake.address, ether(100), { from: alice });
        assert.equal(await cake.balanceOf(piCake.address), ether(200));
        assert.equal(await piCake.totalSupply(), ether(100));
        await piCake.transfer(bob, ether(100), { from: alice });

        // Withdraw
        const res = await piCake.withdraw(ether(200), { from: bob });

        expectEvent(res, 'Withdraw', {
          account: bob,
          underlyingWithdrawn: ether(200),
          piBurned: ether(100),
        });

        assert.equal(await cake.balanceOf(bob), ether(200));
        assert.equal(await cake.balanceOf(piCake.address), ether(0));

        assert.equal(await piCake.totalSupply(), ether(0));
        assert.equal(await piCake.balanceOf(bob), ether(0));
      });
    });
  });

  describe('router interface', async () => {
    describe('changeRouter', async () => {
      it('should allow changing a router', async () => {
        const data = await piCake.contract.methods.changeRouter(alice).encodeABI();
        const res = await router.execute(piCake.address, data);

        await expectEvent.inTransaction(res.tx, WrappedPiErc20, 'ChangeRouter', {
          newRouter: alice,
        });
        assert.equal(await piCake.router(), alice);
      });

      it('should deny calling the method from non-router address', async () => {
        await expectRevert(piCake.changeRouter(alice, { from: alice }), 'ONLY_ROUTER');
      });
    });

    describe('setEthFee', async () => {
      it('should deny calling the method from non-router address', async () => {
        await expectRevert(piCake.setEthFee(ether(0.1), { from: alice }), 'ONLY_ROUTER');
      });
    });

    describe('setNoFee', async () => {
      it('should allow setting no fee values', async () => {
        assert.equal(await piCake.noFeeWhitelist(bob), false);
        let data = await piCake.contract.methods.setNoFee(bob, true).encodeABI();
        await router.execute(piCake.address, data);
        assert.equal(await piCake.noFeeWhitelist(bob), true);
        data = await piCake.contract.methods.setNoFee(bob, false).encodeABI();
        await router.execute(piCake.address, data);
        assert.equal(await piCake.noFeeWhitelist(bob), false);
      });

      it('should deny calling the method from non-router address', async () => {
        await expectRevert(piCake.setNoFee(bob, { from: alice }), 'ONLY_ROUTER');
      });
    });

    describe('approveToken', async () => {
      it('should allow the router approving locked tokens', async () => {
        const data = await piCake.contract.methods.approveUnderlying(bob, ether(55)).encodeABI();
        const res = await router.execute(piCake.address, data);

        await expectEvent.inTransaction(res.tx, WrappedPiErc20, 'Approve', {
          to: bob,
          amount: ether(55),
        });
        assert.equal(await cake.allowance(piCake.address, bob), ether(55));
      });

      it('should deny calling the method from non-router address', async () => {
        await expectRevert(piCake.approveUnderlying(alice, ether(33), { from: alice }), 'ONLY_ROUTER');
      });
    });

    describe('callVoting', async () => {
      let signature, args;
      beforeEach(async () => {
        const data = await router.contract.methods.piTokenCallback(bob, ether(15)).encodeABI();
        ({ signature, args } = signatureAndArgs(data));
      });

      it('should allow the router calling any method on any contract', async () => {
        const data2 = await piCake.contract.methods.callExternal(router.address, signature, args, 0).encodeABI();
        const res = await router.execute(piCake.address, data2);

        await expectEvent.inTransaction(res.tx, WrappedPiErc20, 'CallExternal', {
          destination: router.address,
          inputSig: web3.utils.padRight(signature, 64),
          inputData: args,
        });

        await expectEvent.inTransaction(res.tx, MockRouter, 'MockWrapperCallback', {
          withdrawAmount: ether(15),
        });
      });

      it('should deny calling the method from non-router address', async () => {
        await expectRevert(piCake.callExternal(alice, signature, args, 0, { from: alice }), 'ONLY_ROUTER');

        await expectRevert(piCake.callExternalMultiple([{
          destination: alice,
          signature: signature,
          args: args,
          value: 0,
        }], { from: alice }), 'ONLY_ROUTER');
      });
    });
  });
});
