/* global artifacts, web3, contract */
require('chai').use(require('bn-chai')(web3.utils.BN)).use(require('chai-as-promised')).should()
const { takeSnapshot, revertSnapshot } = require('../scripts/ganacheHelper')
const { toBN } = require('web3-utils')
const RLP = require('rlp')

const Dewo = artifacts.require('./DEWOMock.sol')
const Voucher = artifacts.require('./VoucherMock.sol')

async function getNextAddr(sender, offset = 0) {
  const nonce = await web3.eth.getTransactionCount(sender)
  return (
    '0x' +
    web3.utils
      .sha3(RLP.encode([sender, Number(nonce) + Number(offset)]))
      .slice(12)
      .substring(14)
  )
}

contract('Voucher', (accounts) => {
  let dewo
  let voucher
  let snapshotId
  // const owner = accounts[0]
  // const ownerPrivateKey = '0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce9c46f30d7d21715b23b1d'
  const recipient = accounts[1]
  const governance = accounts[8]
  let startTimestamp
  const duration = toBN(60 * 60 * 24 * 365)
  const cap = toBN(10000000).mul(toBN(10 ** 18))

  before(async () => {
    const voucherExpectedAddr = await getNextAddr(accounts[0], 1)
    const thirtyDays = 30 * 24 * 3600
    dewo = await Dewo.new(governance, thirtyDays, [{ to: voucherExpectedAddr, amount: cap.toString() }])
    voucher = await Voucher.new(dewo.address, governance, duration, [
      { to: accounts[0], amount: cap.toString() },
    ])

    startTimestamp = await voucher.blockTimestamp()
    await voucher.setFakeTimestamp(startTimestamp)
    const blockTimestamp = await voucher.blockTimestamp()
    blockTimestamp.should.be.eq.BN(startTimestamp)

    await voucher.transfer(recipient, cap.div(toBN(10)))

    snapshotId = await takeSnapshot()
  })

  describe('#constructor', () => {
    it('should be initialized', async () => {
      const expiresAt = await voucher.expiresAt()
      expiresAt.should.be.eq.BN(startTimestamp.add(duration))

      const balance = await dewo.balanceOf(voucher.address)
      balance.should.be.eq.BN(cap)

      const vDEWORecipientBalance = await voucher.balanceOf(recipient)
      vDEWORecipientBalance.should.be.eq.BN(cap.div(toBN(10)))
    })
  })

  describe('#redeem', () => {
    it('should work', async () => {
      const vDEWORecipientBalanceBefore = await voucher.balanceOf(recipient)
      const DEWORecipientBalanceBefore = await dewo.balanceOf(recipient)
      await voucher.redeem({ from: recipient })
      const vDEWORecipientBalanceAfter = await voucher.balanceOf(recipient)
      const DEWORecipientBalanceAfter = await dewo.balanceOf(recipient)

      vDEWORecipientBalanceAfter.should.be.eq.BN(toBN(0))
      DEWORecipientBalanceBefore.should.be.eq.BN(toBN(0))
      DEWORecipientBalanceAfter.should.be.eq.BN(vDEWORecipientBalanceBefore)
    })

    it('can redeem if time has passed', async () => {
      await voucher.redeem({ from: recipient })

      const expiresAt = await voucher.expiresAt()
      await voucher.setFakeTimestamp(expiresAt)

      await voucher.redeem({ from: recipient }).should.be.rejectedWith('Airdrop redeem period has ended')
    })
  })

  describe('#rescueExpiredTokens', () => {
    it('should not work if time has not passed', async () => {
      await voucher.rescueExpiredTokens().should.be.rejectedWith('Airdrop redeem period has not ended yet')
    })

    it('should work if time has passed', async () => {
      await voucher.redeem({ from: recipient })

      const expiresAt = await voucher.expiresAt()
      await voucher.setFakeTimestamp(expiresAt)

      const balanceBefore = await dewo.balanceOf(governance)
      const voucherBalanceBefore = await dewo.balanceOf(voucher.address)
      await voucher.rescueExpiredTokens()
      const balanceAfter = await dewo.balanceOf(governance)
      balanceAfter.should.be.eq.BN(balanceBefore.add(voucherBalanceBefore))
    })
  })

  describe('#pause', () => {
    it('should be paused', async () => {
      const amount = await voucher.balanceOf(recipient)
      await voucher
        .transfer(accounts[4], amount, { from: recipient })
        .should.be.rejectedWith('ERC20: transfer is not allowed')
    })
  })

  afterEach(async () => {
    await revertSnapshot(snapshotId.result)
    // eslint-disable-next-line require-atomic-updates
    snapshotId = await takeSnapshot()
  })
})
