import { ethers, waffle } from 'hardhat'
import { UniswapV3Factory } from '../typechain/UniswapV3Factory'
import { expect } from './shared/expect'
import snapshotGasCost from './shared/snapshotGasCost'

import { FeeAmount, getCreate2Address, TICK_SPACINGS } from './shared/utilities'

const { constants } = ethers

const TEST_ADDRESSES: [string, string] = [
  '0x1000000000000000000000000000000000000000',
  '0x2000000000000000000000000000000000000000',
]

const createFixtureLoader = waffle.createFixtureLoader

describe('UniswapV3Factory', () => {
  const [wallet, other] = waffle.provider.getWallets()

  let factory: UniswapV3Factory
  let poolContractFactory: any
  let poolBytecode: string
  let libraries: any

  let loadFixture: ReturnType<typeof createFixtureLoader>
  before('create fixture loader', async () => {
    loadFixture = createFixtureLoader([wallet, other])
  })

  before('load pool bytecode', async () => {
    const position = await (await ethers.getContractFactory('Position')).deploy()
    const oracle = await (await ethers.getContractFactory('Oracle')).deploy()
    const swapMath = await (await ethers.getContractFactory('SwapMath')).deploy()
    const tick = await (await ethers.getContractFactory('Tick')).deploy()
    const tickBitmap = await (await ethers.getContractFactory('TickBitmap')).deploy()
    const tickMath = await (await ethers.getContractFactory('TickMath')).deploy()
    libraries = {
      Position: position.address,
      Oracle: oracle.address,
      Tick: tick.address,
      TickBitmap: tickBitmap.address,
      TickMath: tickMath.address,
      SwapMath: swapMath.address,
    }
    poolContractFactory = await ethers.getContractFactory('UniswapV3Pool', { libraries })
    poolBytecode = poolContractFactory.bytecode
  })

  beforeEach('deploy factory', async () => {
    const deployer = await (await ethers.getContractFactory('UniswapV3PoolDeployer', { libraries })).deploy()
    const factoryFactory = await ethers.getContractFactory('UniswapV3Factory', {
      libraries: {
        UniswapV3PoolDeployer: deployer.address,
      },
    })
    factory = (await factoryFactory.deploy()) as UniswapV3Factory
  })

  it('owner is deployer', async () => {
    expect(await factory.owner()).to.eq(wallet.address)
  })

  it('factory bytecode size', async () => {
    expect(((await waffle.provider.getCode(factory.address)).length - 2) / 2).to.matchSnapshot()
  })

  it('pool bytecode size', async () => {
    await factory.createPool(TEST_ADDRESSES[0], TEST_ADDRESSES[1], FeeAmount.MEDIUM)
    const poolAddress = getCreate2Address(factory.address, TEST_ADDRESSES, FeeAmount.MEDIUM, poolBytecode)
    expect(((await waffle.provider.getCode(poolAddress)).length - 2) / 2).to.matchSnapshot()
  })

  it('initial enabled fee amounts', async () => {
    expect(await factory.feeAmountTickSpacing(FeeAmount.LOW)).to.eq(TICK_SPACINGS[FeeAmount.LOW])
    expect(await factory.feeAmountTickSpacing(FeeAmount.MEDIUM)).to.eq(TICK_SPACINGS[FeeAmount.MEDIUM])
    expect(await factory.feeAmountTickSpacing(FeeAmount.HIGH)).to.eq(TICK_SPACINGS[FeeAmount.HIGH])
  })

  async function createAndCheckPool(
    tokens: [string, string],
    feeAmount: FeeAmount,
    tickSpacing: number = TICK_SPACINGS[feeAmount]
  ) {
    const create2Address = getCreate2Address(factory.address, tokens, feeAmount, poolBytecode)
    const create = factory.createPool(tokens[0], tokens[1], feeAmount)

    const { logs } = await (await create).wait()
    // Cannot seem to parse events with waffle for some reason?
    // await expect(create)
    // .to.emit(factory, 'PoolCreated')
    // .withArgs(TEST_ADDRESSES[0], TEST_ADDRESSES[1], feeAmount, tickSpacing, create2Address)
    const log = factory.interface.decodeEventLog('PoolCreated', logs[1].data, logs[1].topics)
    expect(log.token0).to.be.eq(TEST_ADDRESSES[0])
    expect(log.token1).to.be.eq(TEST_ADDRESSES[1])
    expect(log.fee).to.be.eq(feeAmount)
    expect(log.tickSpacing).to.be.eq(tickSpacing)
    expect(log.pool).to.be.eq(create2Address)

    await expect(factory.createPool(tokens[0], tokens[1], feeAmount)).to.be.reverted
    await expect(factory.createPool(tokens[1], tokens[0], feeAmount)).to.be.reverted
    expect(await factory.getPool(tokens[0], tokens[1], feeAmount), 'getPool in order').to.eq(create2Address)
    expect(await factory.getPool(tokens[1], tokens[0], feeAmount), 'getPool in reverse').to.eq(create2Address)

    const pool = poolContractFactory.attach(create2Address)
    expect(await pool.factory(), 'pool factory address').to.eq(factory.address)
    expect(await pool.token0(), 'pool token0').to.eq(TEST_ADDRESSES[0])
    expect(await pool.token1(), 'pool token1').to.eq(TEST_ADDRESSES[1])
    expect(await pool.fee(), 'pool fee').to.eq(feeAmount)
    expect(await pool.tickSpacing(), 'pool tick spacing').to.eq(tickSpacing)
  }

  describe('#createPool', () => {
    it('succeeds for low fee pool', async () => {
      await createAndCheckPool(TEST_ADDRESSES, FeeAmount.LOW)
    })

    it('succeeds for medium fee pool', async () => {
      await createAndCheckPool(TEST_ADDRESSES, FeeAmount.MEDIUM)
    })
    it('succeeds for high fee pool', async () => {
      await createAndCheckPool(TEST_ADDRESSES, FeeAmount.HIGH)
    })

    it('succeeds if tokens are passed in reverse', async () => {
      await createAndCheckPool([TEST_ADDRESSES[1], TEST_ADDRESSES[0]], FeeAmount.MEDIUM)
    })

    it('fails if token a == token b', async () => {
      await expect(factory.createPool(TEST_ADDRESSES[0], TEST_ADDRESSES[0], FeeAmount.LOW)).to.be.reverted
    })

    it('fails if token a is 0 or token b is 0', async () => {
      await expect(factory.createPool(TEST_ADDRESSES[0], constants.AddressZero, FeeAmount.LOW)).to.be.reverted
      await expect(factory.createPool(constants.AddressZero, TEST_ADDRESSES[0], FeeAmount.LOW)).to.be.reverted
      await expect(factory.createPool(constants.AddressZero, constants.AddressZero, FeeAmount.LOW)).to.be.reverted
    })

    it('fails if fee amount is not enabled', async () => {
      await expect(factory.createPool(TEST_ADDRESSES[0], TEST_ADDRESSES[1], 250)).to.be.reverted
    })

    it('gas', async () => {
      await snapshotGasCost(factory.createPool(TEST_ADDRESSES[0], TEST_ADDRESSES[1], FeeAmount.MEDIUM))
    })
  })

  describe('#setOwner', () => {
    it('fails if caller is not owner', async () => {
      await expect(factory.connect(other).setOwner(wallet.address)).to.be.reverted
    })

    it('updates owner', async () => {
      const tx = await factory.setOwner(other.address)
      await tx.wait()
      expect(await factory.owner()).to.eq(other.address)
    })

    it('emits event', async () => {
      const tx = await factory.setOwner(other.address)
      const { logs } = await tx.wait()
      const { oldOwner, newOwner } = factory.interface.decodeEventLog('OwnerChanged', logs[1].data, logs[1].topics)
      expect(oldOwner).to.be.eq(wallet.address)
      expect(newOwner).to.be.eq(other.address)
    })

    it('cannot be called by original owner', async () => {
      await factory.setOwner(other.address)
      await expect(factory.setOwner(wallet.address)).to.be.reverted
    })
  })

  describe('#enableFeeAmount', () => {
    it('fails if caller is not owner', async () => {
      await expect(factory.connect(other).enableFeeAmount(100, 2)).to.be.reverted
    })
    it('fails if fee is too great', async () => {
      await expect(factory.enableFeeAmount(1000000, 10)).to.be.reverted
    })
    it('fails if tick spacing is too small', async () => {
      await expect(factory.enableFeeAmount(500, 0)).to.be.reverted
    })
    it('fails if tick spacing is too large', async () => {
      await expect(factory.enableFeeAmount(500, 16834)).to.be.reverted
    })
    it('fails if already initialized', async () => {
      await (await factory.enableFeeAmount(100, 5)).wait()
      await expect(factory.enableFeeAmount(100, 10)).to.be.reverted
    })
    it('sets the fee amount in the mapping', async () => {
      await (await factory.enableFeeAmount(100, 5)).wait()
      expect(await factory.feeAmountTickSpacing(100)).to.eq(5)
    })
    it('emits an event', async () => {
      const tx = await factory.enableFeeAmount(100, 5)
      const { logs } = await tx.wait()
      const log = factory.interface.decodeEventLog('FeeAmountEnabled', logs[1].data, logs[1].topics)
      expect(log[0]).to.be.eq(100)
      expect(log[1]).to.be.eq(5)
    })
    it('enables pool creation', async () => {
      await (await factory.enableFeeAmount(250, 15)).wait()
      await createAndCheckPool([TEST_ADDRESSES[0], TEST_ADDRESSES[1]], 250, 15)
    })
  })
})
