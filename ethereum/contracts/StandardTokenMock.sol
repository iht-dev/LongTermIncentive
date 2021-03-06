pragma solidity ^0.4.18;


import "./StandardToken.sol";


// mock class using StandardToken
contract StandardTokenMock is StandardToken {

    function StandardTokenMock(address initialAccount, uint initialBalance) public {
        balances[initialAccount] = initialBalance;
        totalSupply = initialBalance;
    }

}
