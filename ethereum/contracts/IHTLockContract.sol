pragma solidity ^0.4.18;
import "./Ownable.sol";
import "./SafeMath.sol";
import "./Math.sol";
import "./ERC20.sol";
import "./ERC20Basic.sol";

contract IHTLockContract is Ownable{
    using SafeMath for uint;
    using Math for uint;
    
    // During the first 30 days of deployment, this contract opens for deposit of IHT.
    // **Test version** 600 minutes -> 10 hours
    uint public constant DEPOSIT_PERIOD             = 600 minutes; // **Live version** = 1 months

    // Owner can drain all remaining iht after 3 years.
    // **Test version** 1 days
    uint public constant DRAIN_DELAY                = 3 days; // **Live version** = 3 years.
    
    // **Test version** Ropsten IHT token
    address public ihtTokenAddress  = 0xb535984525f3c2805CA598C747Fa40b4646077A0;
    address public bonusPoolAddress = 0x0;

    uint public ihtDeposited        = 0;
    uint public depositStartTime    = 0;
    uint public depositStopTime     = 0;
    uint public maxBonusLimit       = 2000000000000000000000;  // **Test version** 2000 IHT max (in decimal)
    uint public currentBonus        = 0;
    uint public lockStartTime       = 0;
    uint public minAmount           = 500000000000000000000;     // **Test version** 500 IHT min (in decimal)
    uint public maxAmount           = 10000000000000000000000;   // **Test version** 10000 IHT max (in decimal)

    // durations[1] is used as default (see ()), and # of days in year calculation (see calculateBonus())
    uint[3] public durations = [180,360,540];   

    struct Record {
        uint ihtAmount;
        uint timestamp;
        uint lockPeriod;
        uint bonusExpected;
        uint bonusRate;
        bool bonusReleased;
        uint withdrawlTime;
    }
    struct Tranche {
        uint amount;
        uint bonusRate;
    }

    Tranche[100] public tranches;
    uint public trancheCount;
    mapping (address => Record) public records;
    
    /* 
     * EVENTS
     */

    /// Emitted when program starts.
    event Started(uint _time);

    /// Emitted when all iht are drained.
    event Drained(uint _ihtAmount);

    /// Emitted for each sucuessful deposit.
    uint public depositId = 0;
    event Deposit(uint _depositId, address indexed _addr, uint _ihtAmount);

    /// Emitted for each sucuessful deposit.
    uint public withdrawId = 0;
    event Withdrawal(uint _withdrawId, address indexed _addr, uint _ihtAmount);

    /// @dev Initialize the contract
    function IHTLockContract(address _ihtTokenAddress, address _bonusPoolAddress) public {
        
        if(_ihtTokenAddress != 0){
            ihtTokenAddress = _ihtTokenAddress;
        }
        bonusPoolAddress = _bonusPoolAddress;
    }

    /*
     * PUBLIC FUNCTIONS
     */

    /// @dev start the program.
    function start() public onlyOwner {
        require(depositStartTime == 0);

        depositStartTime = now;

        // Check if overridden by setVestingParameters
        if (depositStopTime == 0) {
            depositStopTime  = depositStartTime + DEPOSIT_PERIOD;
        }
        
        if (lockStartTime == 0) {
            lockStartTime = now; 
        }

        emit Started(depositStartTime);
    }

    /// @dev Function to set default vesting schedule parameters
    /// @param _depositStopTime incentive program enrollment period ends in unix timestamp
    /// @param _lockStartTime incentive program lockup period starts in unix timestamp
    /// @param _bonusPoolAddress funding account where the bonus is withdrawn from to pay for incentive program
    function setVestingParameters(uint256 _depositStopTime, uint256 _lockStartTime, address _bonusPoolAddress) onlyOwner public {
        require(depositStartTime == 0);
        require(_depositStopTime > now);

        depositStopTime = _depositStopTime;
        lockStartTime = _lockStartTime;
        bonusPoolAddress = _bonusPoolAddress;

    }

    /// @dev set bonus strategy before calling start() 
    /// @dev e.g. 2 tranches: 50000 <= x <= 250001, 250001 <= x <= 1000001
    /// @dev 3 durations: 6,12,18
    /// @param _bonusRates (thousandth precision): 65,80,90,70,85,95,0,0,0
    /// @param _amount (in decimal 18 unit): 50000000000000000000000, 250001000000000000000000, 1000001000000000000000000
    /// @param _amount : should always begin with the minimum amount and the last value should be greater than the max amount.
    function setBonusStrategy(uint256[] _bonusRates, uint256[] _amount) public onlyOwner {
        require(depositStartTime == 0);
        require(_bonusRates.length == (durations.length * _amount.length)); // bonusRates needs to be a # of durations * # of _amount
        trancheCount = _amount.length - 1;
        for (uint256 i = 0; i < _bonusRates.length; i++) {
            tranches[i].amount = _amount[i / durations.length];  // round down is expected
            tranches[i].bonusRate = _bonusRates[i];
        }
    }

    /// @dev returns the correct rate based on setBonusStrategy() setting 
    /// @param _days see durations array for valid arg value, only support 3 now
    /// @param _amount amount in 18 decimal (min, max, tranches set by setBonusStrategy)
    /// @return corresponding rate if found, else 0
    function getRate(uint _days, uint _amount) internal view returns (uint rate){
        require(_days == durations[0] || _days == durations[1] || _days == durations[2]);
        uint index = ( _days == durations[0] ? 0 : ( _days == durations[1] ? 1 : 2 ) );

        for (; index <= SafeMath.mul(durations.length,trancheCount); index += durations.length) {
            if(_amount >= tranches[index].amount && _amount < tranches[index+durations.length].amount){
                return tranches[index].bonusRate;
            }
        }
        return 0;
    }


    /// @dev drain iht.
    function drain() public onlyOwner {
        require(depositStartTime > 0 && now >= depositStartTime + DRAIN_DELAY);

        uint balance = ihtBalance();
        require(balance > 0);
        ERC20 ihtToken = ERC20(ihtTokenAddress);
        require(ihtToken.transfer(msg.sender, balance));

        emit Drained(balance);
    }

    function () payable public {
        require(depositStartTime > 0);

        if (now >= depositStartTime && now <= depositStopTime) {
            depositIHT(durations[1]);   // default is 360 days
        } else if (now > depositStopTime){
            withdrawIHT();
        } else {
            revert();
        }
    }

    /// @dev returns the bonus based on the rate, amount, and duration it was locked for 
    /// @param _days see durations array for valid arg value, only support 3 now
    /// @param _amount amount in 18 decimal (min, max, tranches set by setBonusStrategy)
    /// @return round down to 0 decimal bonus amount
    function calculateBonus(uint _days, uint _amount) internal view returns (uint bonusAmount){
        // divide by 100 to offset month precision (6 months -> 600 / 12 => 50%)
        // divide by 1000 to offset rate precision (6.5% is 65)
        bonusAmount = SafeMath.mul(SafeMath.mul(_amount,getRate(_days,_amount)),SafeMath.mul(_days,100)/360) / SafeMath.mul(100, 1000);
    }

    function deposit180() public {
        depositIHT(durations[0]);
    }

    function deposit360() public {
        depositIHT(durations[1]);
    }

    function deposit540() public {
        depositIHT(durations[2]);
    }

    /// @dev Deposit iht.
    function depositIHT(uint _days) private {
        require(depositStartTime > 0);
        require(msg.value == 0);
        require(now >= depositStartTime && now <= depositStopTime);
        
        var ihtToken = ERC20(ihtTokenAddress);
        uint ihtAmount = ihtToken
            .balanceOf(msg.sender)
            .min256(ihtToken.allowance(msg.sender, address(this)));

        require(ihtAmount >= minAmount);
        if(ihtAmount > maxAmount) ihtAmount = maxAmount;
        uint _rate = getRate(_days,ihtAmount);
        uint _bonus = calculateBonus(_days,ihtAmount);
        require(SafeMath.add(currentBonus, _bonus) <= maxBonusLimit);

        var record = records[msg.sender];
        require(record.timestamp == 0);
        require(!record.bonusReleased);
        require(ihtToken.transferFrom(msg.sender, address(this), ihtAmount));
        
        record.ihtAmount = ihtAmount;
        record.timestamp = lockStartTime;
        record.lockPeriod = SafeMath.add(lockStartTime,SafeMath.mul(_days,10)); // ** Test version ** 10 seconds per day
        //86400 => 24 hours * 60 minutes * 60 seconds
        record.bonusRate = _rate;
        record.bonusExpected = _bonus;
        record.bonusReleased = false;
        records[msg.sender] = record;

        ihtDeposited = SafeMath.add(ihtDeposited, ihtAmount);
        currentBonus = SafeMath.add(currentBonus, _bonus);

        emit Deposit(depositId++, msg.sender, ihtAmount);
    }

    // @dev Withdrawal iht.
    function withdrawIHT() payable public {
        require(depositStartTime > 0);
        require(ihtDeposited > 0);
        uint totalAmount = 0;
        var ihtToken = ERC20(ihtTokenAddress);

        var record = records[msg.sender];
        require(!record.bonusReleased);

        if(now >= record.lockPeriod){
            totalAmount = SafeMath.add(record.ihtAmount,record.bonusExpected);
            ihtDeposited = SafeMath.sub(ihtDeposited, record.ihtAmount);
            currentBonus = SafeMath.sub(currentBonus, record.bonusExpected);
            record.bonusReleased = true;
            record.withdrawlTime = block.timestamp;

            emit Withdrawal(withdrawId++, msg.sender, totalAmount);

            require(ihtToken.transfer(msg.sender, record.ihtAmount));
            require(ihtToken.allowance(bonusPoolAddress, address(this)) >= record.bonusExpected);
            require(ihtToken.transferFrom(bonusPoolAddress, msg.sender, record.bonusExpected));

        } else {
            totalAmount = record.ihtAmount;
            ihtDeposited = SafeMath.sub(ihtDeposited, record.ihtAmount);
            record.bonusReleased = true;
            record.withdrawlTime = block.timestamp;

            emit Withdrawal(withdrawId++, msg.sender, totalAmount);

            require(ihtToken.transfer(msg.sender, record.ihtAmount));
        }
        record.bonusExpected = 0;

        if (msg.value > 0) {
            msg.sender.transfer(msg.value);
        }
    }

    // @dev Withdrawal iht.
    function withdrawForInvestor(address[] _investors) onlyOwner payable public {
        require(depositStartTime > 0);
        require(ihtDeposited > 0);
        uint totalAmount = 0;
        var ihtToken = ERC20(ihtTokenAddress);
        Record storage record;

        for(uint i = 0; i < _investors.length ; i++) {
            record = records[_investors[i]];
            require(!record.bonusReleased);
            require(now >= record.lockPeriod);
            totalAmount = SafeMath.add(record.ihtAmount,record.bonusExpected);
            ihtDeposited = SafeMath.sub(ihtDeposited, record.ihtAmount);
            currentBonus = SafeMath.sub(currentBonus, record.bonusExpected);
            record.bonusReleased = true;
            record.withdrawlTime = block.timestamp;

            emit Withdrawal(withdrawId++, _investors[i], totalAmount);

            require(ihtToken.transfer(_investors[i], record.ihtAmount));
            require(ihtToken.allowance(bonusPoolAddress, address(this)) >= record.bonusExpected);
            require(ihtToken.transferFrom(bonusPoolAddress, _investors[i], record.bonusExpected));
            record.bonusExpected = 0;
        }

        if (msg.value > 0) {
            msg.sender.transfer(msg.value);
        }
    }


    /// @return Current iht balance.
    function ihtBalance() public view returns (uint) {
        return ERC20(ihtTokenAddress).balanceOf(address(this));
    }
}