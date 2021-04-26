import 'hardhat-typechain'
import '@nomiclabs/hardhat-ethers'
import '@nomiclabs/hardhat-waffle'
import '@nomiclabs/hardhat-etherscan'
import '@eth-optimism/hardhat-ovm'
import 'hardhat-contract-sizer'

import { BigNumber, providers } from 'ethers'

import { extendEnvironment } from "hardhat/config";
extendEnvironment((hre) => {
  if (hre.network.name == 'optimism') {
    // Override Waffle Fixtures to be no-ops, because l2geth does not support
    // snapshotting
    // @ts-ignore
    hre.waffle.loadFixture = async (fixture: Promise<any>) => await fixture()

    // Temporarily set gasPrice = 0, until l2geth provides pre-funded l2 accounts.
    const provider = new providers.JsonRpcProvider("http://localhost:8545")
    provider.pollingInterval = 100
    provider.getGasPrice = async () => BigNumber.from(0)
    hre.ethers.provider = provider
  }
});
export default {
  networks: {
    hardhat: {
      allowUnlimitedContractSize: false,
    },
    mainnet: {
      url: `https://mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
    },
    ropsten: {
      url: `https://ropsten.infura.io/v3/${process.env.INFURA_API_KEY}`,
    },
    rinkeby: {
      url: `https://rinkeby.infura.io/v3/${process.env.INFURA_API_KEY}`,
    },
    goerli: {
      url: `https://goerli.infura.io/v3/${process.env.INFURA_API_KEY}`,
    },
    kovan: {
      url: `https://kovan.infura.io/v3/${process.env.INFURA_API_KEY}`,
    },
    optimism: {
      url: "http://localhost:8545",
      ovm: true,
    },
  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  solidity: {
    version: '0.7.6',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1,
      },
      metadata: {
        // do not include the metadata hash, since this is machine dependent
        // and we want all generated code to be deterministic
        // https://docs.soliditylang.org/en/v0.7.6/metadata.html
        bytecodeHash: 'none',
      },
    },
  },
}
