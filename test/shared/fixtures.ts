import { BigNumber, Contract } from 'ethers'
import { ethers, network } from 'hardhat'
import { MockTimeUniswapV3Pool } from '../../typechain/MockTimeUniswapV3Pool'
import { TestERC20 } from '../../typechain/TestERC20'
import { UniswapV3Factory } from '../../typechain/UniswapV3Factory'
import { TestUniswapV3Callee } from '../../typechain/TestUniswapV3Callee'
import { TestUniswapV3Router } from '../../typechain/TestUniswapV3Router'
import { MockTimeUniswapV3PoolDeployer } from '../../typechain/MockTimeUniswapV3PoolDeployer'

import { Fixture } from 'ethereum-waffle'

interface FactoryFixture {
  factory: UniswapV3Factory
  deployer: Contract
  libraries: any
}

const OVERRIDES = { gasLimit: 8500000 }

const deployLib = async (name: string, libraries?: any): Promise<string> => {
  const lib = await (await ethers.getContractFactory(name, { libraries })).deploy(OVERRIDES)
  await lib.deployTransaction.wait()
  return lib.address
}

// NB: OVM_ETH emits an additional `Transfer` event which means we need to change
// take the 2nd element from the receipt's logs.
const RECEIPT_OFFSET = network.name == 'optimism' ? 1 : 0

export async function factoryFixture(): Promise<FactoryFixture> {
  const libraries = {
    Position: await deployLib('Position'),
    Oracle: await deployLib('Oracle'),
    Tick: await deployLib('Tick'),
    TickBitmap: await deployLib('TickBitmap'),
    TickMath: await deployLib('TickMath'),
    SwapMath: await deployLib('SwapMath'),
  }

  const deployer = await (await ethers.getContractFactory('UniswapV3PoolDeployer', { libraries })).deploy(OVERRIDES)
  await deployer.deployTransaction.wait()
  const factoryFactory = await ethers.getContractFactory('UniswapV3Factory', {
    libraries: {
      UniswapV3PoolDeployer: await deployLib('UniswapV3PoolDeployer', libraries),
    },
  })
  const factory = (await factoryFactory.deploy(OVERRIDES)) as UniswapV3Factory
  await factory.deployTransaction.wait()
  return { factory, deployer, libraries }
}

interface TokensFixture {
  token0: TestERC20
  token1: TestERC20
  token2: TestERC20
}

async function tokensFixture(): Promise<TokensFixture> {
  const tokenFactory = await ethers.getContractFactory('TestERC20')
  const tokenA = (await tokenFactory.deploy(BigNumber.from(2).pow(255), OVERRIDES)) as TestERC20
  await tokenA.deployTransaction.wait()
  const tokenB = (await tokenFactory.deploy(BigNumber.from(2).pow(255), OVERRIDES)) as TestERC20
  await tokenB.deployTransaction.wait()
  const tokenC = (await tokenFactory.deploy(BigNumber.from(2).pow(255), OVERRIDES)) as TestERC20
  await tokenC.deployTransaction.wait()

  const [token0, token1, token2] = [tokenA, tokenB, tokenC].sort((tokenA, tokenB) =>
    tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? -1 : 1
  )

  return { token0, token1, token2 }
}

type TokensAndFactoryFixture = FactoryFixture & TokensFixture

interface PoolFixture extends TokensAndFactoryFixture {
  swapTargetCallee: TestUniswapV3Callee
  swapTargetRouter: TestUniswapV3Router
  createPool(
    fee: number,
    tickSpacing: number,
    firstToken?: TestERC20,
    secondToken?: TestERC20
  ): Promise<MockTimeUniswapV3Pool>
}

// Monday, October 5, 2020 9:00:00 AM GMT-05:00
export const TEST_POOL_START_TIME = 1601906400

export const poolFixture: Fixture<PoolFixture> = async function (): Promise<PoolFixture> {
  const { factory, libraries, deployer } = await factoryFixture()
  const { token0, token1, token2 } = await tokensFixture()

  const MockTimeUniswapV3PoolDeployerFactory = await ethers.getContractFactory('MockTimeUniswapV3PoolDeployer', {
    libraries: {
      MockDeployerLib: await deployLib('MockDeployerLib', libraries),
    },
  })
  const MockTimeUniswapV3PoolFactory = await ethers.getContractFactory('MockTimeUniswapV3Pool', { libraries })

  const calleeContractFactory = await ethers.getContractFactory('TestUniswapV3Callee')
  const routerContractFactory = await ethers.getContractFactory('TestUniswapV3Router')

  const swapTargetCallee = (await calleeContractFactory.deploy(OVERRIDES)) as TestUniswapV3Callee
  await swapTargetCallee.deployTransaction.wait()
  const swapTargetRouter = (await routerContractFactory.deploy(OVERRIDES)) as TestUniswapV3Router
  await swapTargetRouter.deployTransaction.wait()

  return {
    libraries,
    deployer,
    token0,
    token1,
    token2,
    factory,
    swapTargetCallee,
    swapTargetRouter,
    createPool: async (fee: number, tickSpacing: number, firstToken = token0, secondToken = token1) => {
      const mockTimePoolDeployer = (await MockTimeUniswapV3PoolDeployerFactory.deploy(
        OVERRIDES
      )) as MockTimeUniswapV3PoolDeployer
      await mockTimePoolDeployer.deployTransaction.wait()
      const tx = await mockTimePoolDeployer.deploy(
        factory.address,
        firstToken.address,
        secondToken.address,
        fee,
        tickSpacing,
        OVERRIDES
      )

      const receipt = await tx.wait()
      const poolAddress = receipt.events?.[RECEIPT_OFFSET].args?.pool as string
      return MockTimeUniswapV3PoolFactory.attach(poolAddress) as MockTimeUniswapV3Pool
    },
  }
}
