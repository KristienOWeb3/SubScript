require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
      outputSelection: {
        "*": {
          "*": ["storageLayout", "abi", "evm.bytecode"]
        }
      }
    },
  },
  networks: {
    /* Default Hardhat in-memory network (for tests) */
    hardhat: {},

    /* Local Hardhat node  (`npx hardhat node`) */
    localhost: {
      url: "http://127.0.0.1:8545",
    },

    /* Arc Testnet (uses values from .env) */
    arcTestnet: {
      url: process.env.RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};
