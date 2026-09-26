const crypto = require('./crypto');
const match = require('./provider/match');
const { DEFAULT_SOURCE } = require('./consts');
const { logger } = require('./logger');
const select = require('./provider/select');

test('crypto kw',()=>{

})

describe('crypto', () => {
	test('crypto kw', () => {
		const url= 'http://mobi.kuwo.cn/mobi.s?f=kuwo&q='+
		crypto.kuwoapi.encryptQuery('corp=kuwo&source=kwplayercar_ar_6.3.9.40_C_APK_guanwang.apk&p2p=1&type=convert_url2&sig=0&format='+['flac', 'mp3'].slice(true ? 0 : 1).join('|')+'&rid=622245')
		console.log(url)
	})
})

describe('crypto',()=>{
	test('crypto kw',()=>{
		const q = "OMInazPx6ham1X3dgseC8OIx3VVhKubl94a590oOQhxPyLDu8o7AhBa0LJxzUq9v27jFds1ERx1NLrZROkUAL8N2ZK7oAAs2uCL/f/72ATPfMb8XHWpDUz8ZT2trpof41FQsjXQ7U68Iqwxhc+BuB5EBxG9SqEB2QAncLg3dcY+rD1BgBHckwejsz7tnDBxhRxx380L0l0sWxXL+28KCS7F7YoIGxAtyMz78o/+jjDoAoP4l7i+i1zod76Amkf6Ij0nXfTjgrDfLpCgPVWGB/UA/iow/jD80QBxAN6BSEIIzIKVxVhSW7tiF+OHLFFqROQEFcUuxOePnkXUFY/jxQa4VanMN1WL8UEnEQbeiBNMI6wFncCyXEKhAxeYGgEWRm7muslI11+vToVctmRRqmoKkGkJuUGsCNu386oXCGTzRANKjmTlKGRr1BkXJB3RMVGipUfNPt/Gz+2AIX46p5GOJmLFBfv5L8uIREx8gZ+vekgCEUCMpKnzdMXVJYXqLR3hg+Iw4Z34EfFXBUlQOz0ayq7it74Kd7dBrg7Hs6z5XpFxvHpenOIPzXrl2ErfEq06jqqAEa41QNvW8V/+RIjwi9QM0iDji3gmmX7bHvziiE/2zlNli6LLk1R1nTOHrt3VkJ4CbWZgk5uf8BMaGz7+5u0QO4tV1kQS58cOGybtOXzS+8CTqM8oP4X/vzRRZTS5sdcfk7sXnkXUFY/jxQWzAZUrc6mHRbXrZ3zQprHVuVpPKd2XDbjJCR1T0EKL8hld+cjuV6a5uVpPKd2XDbiwuUbc6o2J39H7IxGSE+CMMkbfLQCdvsQhwD0BQT8mI"
		const r = crypto.kuwoapi.decryptQuery(q);
		console.log(r)
	})
})
