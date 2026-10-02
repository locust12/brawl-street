// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {RektArena} from "../src/RektArena.sol";

/// @notice Plain mintable ERC20 for LOCAL anvil tests only.
contract DemoToken {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory n, string memory s, uint8 d) {
        name = n;
        symbol = s;
        decimals = d;
    }

    function mint(address to, uint256 v) external {
        totalSupply += v;
        balanceOf[to] += v;
        emit Transfer(address(0), to, v);
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

/// @notice LOCAL ONLY (anvil, no fork): arena + demo USDC (6 dp) + demo REKT (18 dp), bettors funded.
/// env: OPERATOR, CUT_BPS, BETTORS (comma-separated addresses)
contract LocalDemo is Script {
    function run() external {
        require(block.chainid == 31337, "LocalDemo runs on anvil only");
        address operator = vm.envAddress("OPERATOR");
        address[] memory bettors = vm.envAddress("BETTORS", ",");
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        DemoToken usdc = new DemoToken("USD Coin (demo)", "USDC", 6);
        DemoToken rekt = new DemoToken("Rekt (demo)", "REKT", 18);
        RektArena arena = new RektArena(deployer);
        arena.setOperator(operator);
        arena.setToken(address(usdc), true);
        arena.setRekt(address(rekt));
        arena.setCutBps(uint16(vm.envUint("CUT_BPS")));
        for (uint256 i = 0; i < bettors.length; i++) {
            usdc.mint(bettors[i], 10_000e6);
            rekt.mint(bettors[i], 10_000_000e18);
        }
        vm.stopBroadcast();
        console2.log("ARENA", address(arena));
        console2.log("USDC", address(usdc));
        console2.log("REKT", address(rekt));
    }
}
