const assert = require('assert');
const ganache = require('ganache-cli');
const Web3 = require('web3');
const web3 = new Web3(ganache.provider());

const compiledIHTLockContract = require('../ethereum/build/IHTLockContract.json');
const compiledStandardTokenMock = require('../ethereum/build/StandardTokenMock.json');

require('events').EventEmitter.defaultMaxListeners = 0

let accounts;

let ihtLockContract;
let tokenMock;

let accountTokenMock;

let accountIhtLockContractOwner;
let accountIhtLockContractBonusPoolAddress;

let accountPersonNotEnoughToken;
let accountPersonOne;
let accountPersonTwo;
let accountPersonThree;


function etherInWei(x) {
    return web3.utils.toWei(x + '', 'ether')
    // return web3.utils.toBN(web3.utils.toWei(x+'', 'ether')).toString()
}

let toBN = web3.utils.toBN

const math = {
    sub: function (one, two) {
        return toBN(one).sub(toBN(two)).toString()
    },
    add: function (one, two) {
        return toBN(one).add(toBN(two)).toString()
    },
    mul: function (one, mulNumber) {
        return toBN(one).mul(toBN(mulNumber)).toString()
    },
    div: function(one, divNumber) {
        return toBN(one).div(toBN(divNumber)).toString()
    }
}

var LOCK_INFO = {
    amountRange: [
        etherInWei(500),
        etherInWei(2500),
        etherInWei(10000)
    ],
    amountRangeInput: function () {
        return [
            this.amountRange[0],
            math.add(this.amountRange[1], 1),
            math.add(this.amountRange[2], 1)
        ]
    },
    amountLimitMin: function () {
        return this.amountRange[0]
    },
    amountLimitMax: function () {
        return this.amountRange[this.amountRange.length - 1]
    },
    getAmountLessThanLimitMin: function () {
        return math.sub(this.amountLimitMin(), 1)
    },
    getAmountMoreThanLimitMax: function (mulNumber = 2) {
        return math.mul(this.amountLimitMax(), mulNumber)
    },
    // 区间奖励
    boundsRatesFristRange: [70, 90, 115],
    boundsRatesSecondRange: [75, 95, 120],
    boundsRatesRange: function () {
        return [...this.boundsRatesFristRange, ...this.boundsRatesSecondRange, ...[0,0,0]]
    }
}


// Create company and ato contracts
beforeEach(async () => {
    accounts = await web3.eth.getAccounts();

    accountIhtLockContractOwner = accounts[0]
    accountIhtLockContractBonusPoolAddress = accounts[2]
    accountTokenMock = accounts[3]

    accountPersonNotEnoughToken = accounts[4]
    accountPersonOne = accounts[5]
    accountPersonTwo = accounts[6]
    accountPersonThree = accounts[7]

    tokenMock = await new web3.eth.Contract(JSON.parse(compiledStandardTokenMock.interface))
        .deploy({
            data: compiledStandardTokenMock.bytecode,
            arguments: [accountTokenMock, LOCK_INFO.getAmountMoreThanLimitMax(100)]
        })
        .send(util.params.send(accountTokenMock, '5000000'));
    // 给奖励账号发点token
    await util.tokenMock.transfer(accountIhtLockContractBonusPoolAddress, LOCK_INFO.getAmountMoreThanLimitMax())
    ihtLockContract = await new web3.eth.Contract(JSON.parse(compiledIHTLockContract.interface))
        .deploy({
            data: compiledIHTLockContract.bytecode,
            arguments: [tokenMock.options.address, accountIhtLockContractBonusPoolAddress]
        })
        .send(util.params.sendIHTLockContract('5000000'));
});

describe.only('All tests', () => {
    beforeEach(async () => {
        // 给用户发点币
        await util.tokenMock.transfer(accountPersonNotEnoughToken, LOCK_INFO.getAmountLessThanLimitMin())
        await util.tokenMock.transfer(accountPersonOne, LOCK_INFO.getAmountMoreThanLimitMax())
        await util.tokenMock.transfer(accountPersonTwo, LOCK_INFO.getAmountMoreThanLimitMax())
        await util.tokenMock.transfer(accountPersonThree, LOCK_INFO.getAmountMoreThanLimitMax())
    })
    describe('Deployment and setup of IHTLockContract', () => {
        it('Check deployment of IHTLockContract and token mock', async () => {
            assert.ok(tokenMock.options.address)
            assert.ok(ihtLockContract.options.address);
        });
        it('Token mock can tansfer token to wallet', async () => {
           await util.tokenMock.transfer(accountPersonTwo, 1)
        })
        it('LockContract owner can start the deposit session', async () => {
            await util.ihtLockContract.start()
        });
        it('LockContract owner can setBonusStrategy before start the deposit session', async () => {
            await util.ihtLockContract.setBonusStrategy(LOCK_INFO.boundsRatesRange(), LOCK_INFO.amountRangeInput());
            await util.ihtLockContract.start()
        });
    })
    describe('approve/depositIHT', () => {
        beforeEach(async () => {
            // do start
            await util.ihtLockContract.setBonusStrategy(LOCK_INFO.boundsRatesRange(), LOCK_INFO.amountRangeInput());
            await util.ihtLockContract.start()
        })
        it('User should be able to deposit by directly sending tokens to the contract', async () => {
            await util.tokenMock.approveToContract(accountPersonOne, LOCK_INFO.amountLimitMin())
            await util.tokenMock.tansferToContract(accountPersonOne)
            await util.tokenMock.approveToContract(accountPersonTwo, LOCK_INFO.amountLimitMax())
            await util.tokenMock.tansferToContract(accountPersonTwo)
        });
        it('If amount exceeds the max amount, then amount should be equal to max amount', async () => {
            await util.tokenMock.approveToContract(accountPersonThree, math.add(LOCK_INFO.amountLimitMax(), 100))
            await util.tokenMock.tansferToContract(accountPersonThree)
        })
        it('LockContract can deposit first time period token after user approve ', async () => {
            await util.tokenMock.approveToContract(accountPersonOne, LOCK_INFO.amountLimitMin())
            await util.ihtLockContract.despoitFirstTimePeriod(accountPersonOne)
        }),
        it('LockContract can deposit second time period token after user approve ', async () => {
           await util.tokenMock.approveToContract(accountPersonTwo, LOCK_INFO.amountLimitMax())
           await util.ihtLockContract.despoitSecondTimePeriod(accountPersonTwo)
        }),
        it('LockContract can deposit thrid token after user approve ', async () => {
            await util.tokenMock.approveToContract(accountPersonThree, math.add(LOCK_INFO.amountLimitMax(), 100))
            await util.ihtLockContract.despoitThridTimePeriod(accountPersonThree)
        }),
        it('User can withdraw token after approve/despoit and before the end of the despoit stop time', async () => {
            let user = accountPersonOne
            await util.tokenMock.approveToContract(user, LOCK_INFO.amountLimitMin())
            await util.tokenMock.tansferToContract(user)
            await util.ihtLockContract.withdrawToken(user)
        })
    })
    describe('Negative cases', () => {
        beforeEach(async () => {
            // do start
            await util.ihtLockContract.setBonusStrategy(LOCK_INFO.boundsRatesRange(), LOCK_INFO.amountRangeInput());
            await util.ihtLockContract.start()
        })
        it('User can not do approve/despoit amount which is less than limit min amount', async () => {
            try {
                await util.tokenMock.approveToContract(accountPersonOne, LOCK_INFO.getAmountLessThanLimitMin())
                await util.ihtLockContract.despoitFirstTimePeriod(accountPersonOne)
            } catch (error) {
                assert.ok(error)
                return
            }
            failCanNotBeHere()
        })
        it('User can not do sencod approve/despoit', async () => {
            await util.tokenMock.approveToContract(accountPersonOne, LOCK_INFO.amountLimitMin())
            await util.ihtLockContract.despoitFirstTimePeriod(accountPersonOne)
            try {
                await util.tokenMock.approveToContract(accountPersonOne, LOCK_INFO.amountLimitMin())
                await util.ihtLockContract.despoitFirstTimePeriod(accountPersonOne)
            } catch (error) {
                assert.ok(error)
                return
            }
            failCanNotBeHere()
        })
    })
})
 
function failCanNotBeHere() {
    assert.fail(`It shouldn't be here`)
}

const util = {
    getGasInfo: async () => {
        const gasPrice = await web3.eth.getGasPrice();
        const gasPriceHex = await web3.utils.toHex(gasPrice);
        const gasLimitHex = await web3.utils.toHex(3000000);
        return {
            gasPrice,
            gasPriceHex,
            gasLimitHex
        }
    },
    ihtLockContract: {
        start: async () => {
            await ihtLockContract.methods.start().send(util.params.sendIHTLockContract());
            let startTime = await ihtLockContract.methods.depositStartTime().call()
            assert.ok(startTime > 0)
        },
        setBonusStrategy: async (bonusRates, amount) => {
            await ihtLockContract.methods.setBonusStrategy(bonusRates, amount).send(util.params.sendIHTLockContract());
        },
        withdrawToken: async (from) => {
            let balancePrevious = await tokenMock.methods.balanceOf(from).call();
            let record = await ihtLockContract.methods.records(from).call();
            let withdrawAmount = record.ihtAmount;
            let tx = await ihtLockContract.methods.withdrawIHT().send(util.params.send(from))
            assert.ok(tx)
            let balanceCurrent = await tokenMock.methods.balanceOf(from).call();
            assert.ok(balanceCurrent == math.add(balancePrevious, withdrawAmount))
        },
        _despoit: async (timePeriod, from) => {
            let amount = await tokenMock.methods.allowance(from, ihtLockContract.options.address).call()
            assert.ok(timePeriod>=0 && timePeriod <3);
            let depoistMethod
            if(timePeriod == 0){
                depoistMethod = ihtLockContract.methods.deposit180
            } else if (timePeriod == 1) {
                depoistMethod = ihtLockContract.methods.deposit360
            } else if (timePeriod == 2) {
                depoistMethod = ihtLockContract.methods.deposit540
            }
            await depoistMethod().send(util.params.send(from))
            await util.ihtLockContract._validate(from, timePeriod, amount)
        },
        despoitFirstTimePeriod: async function (from) {
            await this._despoit(0, from)
        },
        despoitSecondTimePeriod: async function (from) {
            await this._despoit(1, from)
        },
        despoitThridTimePeriod: async function (from) {
            await this._despoit(2, from)
        },
        _validate: async (from, timePeriod, amount) => {
            let record = await ihtLockContract.methods.records(from).call();
            /*
            Record {
                uint ihtAmount; // 锁仓量
                uint lockStartTime; // 锁仓开始时间
                uint lockEndTime; // 锁仓到期时间
                uint bonusExpected; // 预期奖励
                uint bonusRate; // 利率
                bool bonusReleased; // 奖励+赎回成功
                uint depositTime; // 投币时间
                uint withdrawalTime; // 赎回时间
            }
            */
            assert.ok(record)
            if (math.sub(amount, LOCK_INFO.amountLimitMax()) > 0) {
                amount = LOCK_INFO.amountLimitMax()
            }
            assert.ok(record.ihtAmount == amount)
            let rateIndex = timePeriod;
            let amountRange = LOCK_INFO.amountRange
            let rateRange;
            if (math.sub(amount, amountRange[0]) >= 0 && math.sub(amount, amountRange[1]) <= 0) {
                rateRange = LOCK_INFO.boundsRatesFristRange
            } else if (math.sub(amount, amountRange[1]) > 0 && math.sub(amount, amountRange[2]) <= 0) {
                rateRange = LOCK_INFO.boundsRatesSecondRange
            }
            if (rateRange) {
                assert.ok(record.bonusRate == rateRange[rateIndex])
                assert.ok(record.bonusReleased == false)
            }
        }
    },
    tokenMock: {
        transfer: async (to, amount) => {
            let balancePrevious = await tokenMock.methods.balanceOf(to).call();
            let tx = await tokenMock.methods.transfer(to, amount).send(util.params.sendTokenMock())
            assert.ok(tx)
            let balanceCurrent = await tokenMock.methods.balanceOf(to).call()
            assert.ok(balanceCurrent = math.add(balancePrevious, amount))
        },
        approveToContract: async function (from, amount) {
            let tx = await tokenMock.methods.approve(ihtLockContract.options.address, amount).send(util.params.send(from))
            assert.ok(tx)
        },
        // must do approveToContract frist
        tansferToContract: async function(from) {
            let amount = await tokenMock.methods.allowance(from, ihtLockContract.options.address).call()
            let {
                gasPriceHex,
                gasLimitHex
            } = await util.getGasInfo();
            let balancePrevious = await tokenMock.methods.balanceOf(from).call();
            const nonce = await web3.eth.getTransactionCount(from);
            let tx2 = await web3.eth.sendTransaction({
                from: from,
                nonce: web3.utils.toHex(nonce),
                to: ihtLockContract.options.address,
                gasPrice: gasPriceHex,
                gas: gasLimitHex,
                value: '0x00'
            })
            assert.ok(tx2)
            let balanceCurrent = await tokenMock.methods.balanceOf(from).call();
            assert.ok(balancePrevious = math.add(balanceCurrent, amount))
            await util.ihtLockContract._validate(from, 1, amount)
        }
    },
    params: {
        send: (fromAccountAddress, gas = '1000000') => {
            return {
                from: fromAccountAddress,
                gas
            }
        },
        sendIHTLockContract: (gas) => {
            return util.params.send(accountIhtLockContractOwner, gas)
        },
        sendTokenMock: (gas) => {
            return util.params.send(accountTokenMock, gas)
        }
    }
}