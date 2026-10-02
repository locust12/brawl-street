// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {RektArena} from "../src/RektArena.sol";

/// @notice TESTNET ONLY. An ERC20 anyone can drip from, so judges and players can try the arena
///         without asking us for tokens. Mainnet uses Paxos USDG (0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168).
contract FaucetToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public immutable drip;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => uint256) public lastDrip;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory n, string memory s, uint8 d, uint256 dripAmount) {
        name = n;
        symbol = s;
        decimals = d;
        drip = dripAmount;
    }

    /// @notice Sends `drip` tokens to the caller, at most once an hour per address.
    function faucet() external {
        require(block.timestamp >= lastDrip[msg.sender] + 1 hours, "once an hour");
        lastDrip[msg.sender] = block.timestamp;
        totalSupply += drip;
        balanceOf[msg.sender] += drip;
        emit Transfer(address(0), msg.sender, drip);
    }

    function approve(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] = v;
        emit Approval(msg.sender, s, v);
        return true;
    }

    function transfer(address to, uint256 v) external returns (bool) {
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v;
        emit Transfer(msg.sender, to, v);
        return true;
    }

    function transferFrom(address f, address to, uint256 v) external returns (bool) {
        uint256 a = allowance[f][msg.sender];
        if (a != type(uint256).max) allowance[f][msg.sender] = a - v;
        balanceOf[f] -= v;
        balanceOf[to] += v;
        emit Transfer(f, to, v);
        return true;
    }
}

/// @notice Robinhood Chain TESTNET (46630): test USDG + test REKT with public faucets, and the arena.
/// env: OPERATOR (the operator's address). The broadcasting key stays owner and treasury.
contract TestnetDeploy is Script {
    function run() external {
        require(block.chainid == 46630, "testnet only");
        address operator = vm.envAddress("OPERATOR");

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        FaucetToken usdg = new FaucetToken("USDG (Robinhood testnet)", "USDG", 6, 1_000e6);
        FaucetToken rekt = new FaucetToken("Rekt (Robinhood testnet)", "REKT", 18, 100_000e18);
        RektArena arena = new RektArena(deployer);
        arena.setOperator(operator);
        arena.setTreasury(deployer);
        arena.setToken(address(usdg), true);
        arena.setRekt(address(rekt));
        arena.setCutBps(0);
        vm.stopBroadcast();

        console2.log("RektArena", address(arena));
        console2.log("USDG     ", address(usdg));
        console2.log("REKT     ", address(rekt));
        console2.log("operator ", operator);
    }
}
