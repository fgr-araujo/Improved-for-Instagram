import { Component, createElement } from 'nervjs'
import { bind } from 'decko'
import { shallowDiffers } from './Utils'

const webWorkerScript = `
	const handleResponse = response => response.blob()
	const postMsg = url => self.postMessage(url)
  self.addEventListener('message', event => {
		const url = event.data
    self.fetch(url, { mode: 'no-cors' }).then(handleResponse).then(postMsg.bind(null, url)).catch(console.error)
  })
`

const wrappedComponent = WrappedComponent => props => {
	return <WrappedComponent {...props} />
}

/** Have we initiated the worker pool already? */
let workerPoolCreated = false,
	poolLen = 0
const workerPool = []

function createWorkerPool() {
	const blobURL = URL.createObjectURL(new Blob([webWorkerScript], { type: 'application/javascript' }))
	poolLen = 1 // window.navigator.hardwareConcurrency || 4
	for (let i = 0; i < poolLen; ++i) {
		workerPool.push({
			worker: new Worker(blobURL),
			inUse: false,
			i,
		})
	}
}

/** Returns the next available worker. */
function getNextWorker() {
	for (let i = 0; i < poolLen; ++i) {
		const worker = workerPool[i]
		if (!worker.inUse) {
			worker.inUse = true
			return worker
		}
	}
	// no free found, so we just return the first one
	return workerPool[0]
}

/** Marks worker `index` as available. */
function setFree(index) {
	workerPool[index].inUse = false
}

export default class ImgWorker extends Component {
	constructor(props) {
		super(props)
		this.state = {
			isLoading: true,
		}
		this.img = null

		if (!workerPoolCreated) {
			workerPoolCreated = true
			createWorkerPool()
		}

		this.worker = this.initWorker()
		this.worker.postMessage(props.src || props['data-src'])
	}

	@bind
	initWorker() {
		const workerObj = getNextWorker()
		workerObj.worker.onmessage = event => {
			this.loadImage(event.data)
			setFree(workerObj.i)
		}

		return workerObj.worker
	}

	componentWillReceiveProps(nextProps) {
		const { imgSrc } = this.state
		if (imgSrc !== nextProps.src && imgSrc !== nextProps['data-src']) this.worker.postMessage(nextProps.src || nextProps['data-src'])
	}

	componentWillUnmount() {
		if (this.img !== null) {
			this.img.onload = null
			this.img.onerror = null
		}
	}

	@bind
	renderPlaceholder() {
		const { placeholder, style, placeholderAlt, width, height, decoding, className } = this.props
		if (placeholder !== undefined) {
			if (typeof placeholder === 'function') return wrappedComponent(placeholder)
			if (typeof placeholder === 'object') return placeholder
		}
		return (
			<img
				src={placeholder}
				style={{ ...style }}
				className={className}
				alt={placeholderAlt}
				width={width}
				height={height}
				decoding={decoding}
			/>
		)
	}

	@bind
	async loadImage(url) {
		const img = this.img || new Image()
		this.img = img
		img.src = url
		if (img.decode !== undefined) {
			return img
				.decode()
				.then(this.onload)
				.catch(this.onerror)
		}
		img.onload = this.onload
		img.onerror = this.onerror
	}

	@bind
	onload() {
		this.setState(() => ({ isLoading: false }))
	}

	@bind
	onerror(e) {
		console.error('Failed loading', e)
		// we set the broken URL anyway
		this.onload()
	}

	shouldComponentUpdate(props, state) {
		return shallowDiffers(props, this.props) || shallowDiffers(state, this.state)
	}

	render() {
		const { style, src, placeholderAlt, placeholder /*, ...props */ } = this.props // eslint-disable-line
		const { isLoading } = this.state
		return isLoading ? this.renderPlaceholder() : <img src={this.img.src} style={{ ...style }} {...this.props} /> // props instead of this.props
	}
}
