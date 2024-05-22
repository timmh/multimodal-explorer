import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import { flushSync } from 'react-dom';
import Modal from 'react-modal';
import Select from 'react-select'
import './App.css';
import IntervalTree from '@flatten-js/interval-tree'
import strftime from "strftime"
import 'maplibre-gl/dist/maplibre-gl.css';
import Map, {Marker, ScaleControl} from 'react-map-gl/maplibre';
import Plot from 'react-plotly.js';
import { useDebouncedCallback } from 'use-debounce';

Modal.setAppElement('#root');

const username = "user"
const password = "password"
const apiUrl = "http://localhost:3000"
const apiUrlWithCredentials = apiUrl
const apiUrlSuffix = ""

const scaleLowerBound = 0.1
const scaleUpperBound = 100
const timeFactor = 1000 * 60  // milliseconds to minutes
const timelineUnitSecond = 1000 / timeFactor
const lookupMarginLeft = 100
const lookupMarginRight = 0
const nMaxSamples = 1000

const dtFormat = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'UTC',
});

const dtFormatShort = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'short',
    timeZone: 'UTC',
});

const audioToTimelineTime = (audioCurrentTime, audioStartTime) => (audioCurrentTime * 1000 / timeFactor + audioStartTime)

const timelineToAudioTime = (timelineTime, audioStartTime) => (Math.max(0, timelineTime - audioStartTime) * timeFactor / 1000)

const getImageUrl = (sample) => (
    `${apiUrlWithCredentials}/data/${sample.filename.replace("/tmp/natural_state/", "")}${apiUrlSuffix}`
)

const getImageThumbnailUrl = (sample) => (
    `${apiUrlWithCredentials}/image_thumbnails/${sample.filename.replace(".JPG", ".jpg").replace("/tmp/natural_state/", "")}${apiUrlSuffix}`
)

const getAudioUrl = (sample) => {
    const grid_dir = {
        "RBS Grid 1": "ns-ii-colab-acoustic-grid-1",
        "RBS Grid 2": "ns-ii-colab-acoustic-grid-2/RBS_Grid2",
    }[sample.deployment_group]
    let site
    if (sample.deployment_group != "RBS Grid 2") {
        site = sample.site.replace("RBS", "RBS_")
    } else {
        site = sample.site
    }
    return `${apiUrlWithCredentials}/data/${grid_dir}/${site}/${site}_${strftime("%Y%m%d_%H%M%S", new Date(sample.start))}.wav${apiUrlSuffix}`
}

const getSpectrogramUrl = (sample) => {
    const grid_dir = {
        "RBS Grid 1": "ns-ii-colab-acoustic-grid-1",
        "RBS Grid 2": "ns-ii-colab-acoustic-grid-2/RBS_Grid2",
    }[sample.deployment_group]
    let site
    if (sample.deployment_group != "RBS Grid 2") {
        site = sample.site.replace("RBS", "RBS_")
    } else {
        site = sample.site
    }
    return `${apiUrlWithCredentials}/audio_spectrograms/${grid_dir}/${site}/${site}_${strftime("%Y%m%d_%H%M%S", new Date(sample.start))}.png${apiUrlSuffix}`
}

const useLocalStorageState = (initialValue, key) => {

    const persistedValue = JSON.parse(localStorage.getItem(key))
    const [value, setValue] = useState(persistedValue || initialValue)

    const setValuePersistent = useCallback((nextValue) => {
        localStorage.setItem(key, JSON.stringify(nextValue));
        setValue(nextValue)
    }, [key])

    useEffect(() => {
        const persistedValue = JSON.parse(localStorage.getItem(key))
        if (persistedValue != null) {
            setValue(persistedValue)
        }
    }, [key])

    return [value, setValuePersistent]
}

const readSites = async () => {
    const res = await fetch(`${apiUrl}/json/sites`, {
        headers:  new Headers({'Authorization': 'Basic ' + btoa(username + ":" + password)}),
    })
    let data = await res.json()
    data.sort()

    return data
}

const readImageData = async (sites, labeledOnly) => {
    const resource = labeledOnly ? "image_labels" : "image_files"
    const res = await fetch(`${apiUrl}/json/${resource}?sites=${sites.join(",")}`, {
        headers:  new Headers({'Authorization': 'Basic ' + btoa(username + ":" + password)}),
    })
    const data = await res.json()

    const tree = new IntervalTree()

    const range = data.length > 0 ? [Infinity, -Infinity] : undefined
    
    data.forEach((e, i) => {
        if ((new Date(e.datetime)).getFullYear() < 2022) return // TODO: find more elegant way to filter out wrong dates
        e.backgroundImageUrl = getImageThumbnailUrl(e)
        const start = (new Date(e.datetime)).getTime() / timeFactor
        const end = start + 1
        e.start = start
        e.end = end
        e.densityX = start + (end - start) / 2
        range[0] = Math.min(range[0], start)
        range[1] = Math.max(range[1], end)
        tree.insert([start, end], i)
    })

    return [data, tree, range]
}

const readAudioData = async (sites, labeledOnly) => {
    const resource = labeledOnly ? "audio_labels" : "audio_files"
    const res = await fetch(`${apiUrl}/json/${resource}?sites=${sites.join(",")}`, {
        headers:  new Headers({'Authorization': 'Basic ' + btoa(username + ":" + password)}),
    })
    const data = await res.json()

    const tree = new IntervalTree()

    const range = data.length > 0 ? [Infinity, -Infinity] : undefined
    data.forEach((e, i) => {
        e.audioUrl = getAudioUrl(e)
        e.backgroundImageUrl = getSpectrogramUrl(e)
        const start = (new Date(e.start)).getTime() / timeFactor
        const end = (new Date(e.end)).getTime() / timeFactor
        e.start = start
        e.end = end
        e.densityX = start + (end - start) / 2
        range[0] = Math.min(range[0], start)
        range[1] = Math.max(range[1], end)
        tree.insert([start, end], i)
    })

    return [data, tree, range]
}


function AudioPlayer({sample}) {

    const [currentTimeFraction, setCurrentTimeFraction] = useState(0)

    const handleTimeUpdate = useCallback((evt) => {
        setCurrentTimeFraction(evt.target.currentTime / evt.target.duration)
    })

    return (
        <div>
            <div className="playback-indicator">
                <img src={sample.backgroundImageUrl} />
                <div className="playback-indicator__bar" style={{ left: (currentTimeFraction * 100) + "%" }}></div>
                <audio autoPlay controls src={sample.audioUrl} onTimeUpdate={handleTimeUpdate}></audio>
            </div>
        </div>
    )
}


function App() {
    const [availableSites, setAvailableSites] = useState([])
    const [selectedSites, setSelectedSites] = useState([], "selectedSites")
    const imageApiRequestCounter = useRef(0)
    const audioApiRequestCounter = useRef(0)
    const [imageSamples, setImageSamples] = useState()
    const [audioSamples, setAudioSamples] = useState()
    const [imageSamplesTree, setImageSamplesTree] = useState()
    const [audioSamplesTree, setAudioSamplesTree] = useState()
    const [imageRange, setImageRange] = useState()
    const [audioRange, setAudioRange] = useState()
    const [scale, setScale] = useState(1)
    const [scrollLeft, setScrollLeft] = useState(0)
    const [showImageSampleModal, setShowImageSampleModal] = useState(false)
    const [showAudioSampleModal, setShowAudioSampleModal] = useState(false)
    const [activeImageSampleIdx, setActiveImageSampleIdx] = useState(0)
    const [activeAudioSampleIdx, setActiveAudioSampleIdx] = useState(0)
    const [labeledOnly, setLabeledOnly] = useState(false)
    const [densityPlotWidth, setDensityPlotWidth] = useState(100)
    const densityPlotRef = useRef()
    const timelineRef = useRef()
    const timelineInnerRef = useRef()
    const audioRef = useRef()
    const [playing, setPlaying] = useState(false)
    const [playbackIndicatorPosition, setPlaybackIndicatorPosition] = useState(null)
    const targetHashRef = useRef()
    const imageDensityX = useMemo(() => (imageSamples || []).map(e => e.densityX), [imageSamples])
    const imageDensityY = useMemo(() => (imageSamples || []).map(e => 1), [imageSamples])
    const audioDensityX = useMemo(() => (audioSamples || []).map(e => e.densityX), [audioSamples])
    const audioDensityY = useMemo(() => (audioSamples || []).map(e => 1), [audioSamples])
    
    const scaleRef = useRef()
    useEffect(() => {
        scaleRef.current = scale
    }, [scale, scrollLeft])

    useEffect(() => {
        (async () => {
            const sites = await readSites()
            setAvailableSites(sites)
        })()
    }, [])

    useEffect(() => {
        (async () => {
            imageApiRequestCounter.current += 1
            const currentApiRequestCounter = imageApiRequestCounter.current
            const [data, intervalTree, range] = await readImageData(selectedSites, labeledOnly)
            if (imageApiRequestCounter.current != currentApiRequestCounter) return;
            setImageSamples(data)
            setImageSamplesTree(intervalTree)
            setImageRange(range)
        })()
    }, [selectedSites, labeledOnly])

    useEffect(() => {
        (async () => {
            audioApiRequestCounter.current += 1
            const currentApiRequestCounter = audioApiRequestCounter.current
            const [data, intervalTree, range] = await readAudioData(selectedSites, labeledOnly)
            if (audioApiRequestCounter.current != currentApiRequestCounter) return;
            setAudioSamples(data)
            setAudioSamplesTree(intervalTree)
            setAudioRange(range)
        })()
    }, [selectedSites, labeledOnly])

    const handleWheel = useCallback((evt) => {
        evt.preventDefault()
        flushSync(() => {
            const scale = scaleRef.current
            const scrollLeft = timelineRef.current.scrollLeft
            const nextScale = Math.min(scaleUpperBound, Math.max(scaleLowerBound, Math.exp(Math.log(scale) - evt.deltaY / 1000)))
            setScale(nextScale)
            scaleRef.current = scale
            const scrollCenter = (evt.clientX - timelineRef.current.getBoundingClientRect().left)
            const nextScrollLeft = Math.max(0, evt.deltaX + (nextScale / scale) * (scrollLeft + scrollCenter) - scrollCenter)
            timelineRef.current.scrollLeft = nextScrollLeft
            setScrollLeft(nextScrollLeft)
        })
    }, [scaleRef, setScale, setScrollLeft, timelineRef])

    useEffect(() => {
        timelineRef.current.removeEventListener("wheel", handleWheel)
        timelineRef.current.addEventListener("wheel", handleWheel)
        return () => {
            timelineRef.current && timelineRef.current.removeEventListener("wheel", handleWheel)
        }
    }, [timelineRef])

    const handleScroll = useCallback((evt) => {
        timelineRef.current && setScrollLeft(timelineRef.current.scrollLeft)
    }, [scale])

    const handleImageSampleClick = useCallback((evt) => {
        setActiveImageSampleIdx(parseInt(evt.target.dataset.sampleIdx, 10))
        setShowImageSampleModal(true)
    }, [])
    
    // const handleAudioSampleClick = useCallback((evt) => {
    //     setActiveAudioSampleIdx(parseInt(evt.target.dataset.sampleIdx, 10))
    //     setShowAudioSampleModal(true)
    // }, [])

    const handleImageSampleModalClose = useCallback(() => {
        setShowImageSampleModal(false)
    }, [])

    const handleAudioSampleModalClose = useCallback(() => {
        setShowAudioSampleModal(false)
    }, [])

    const handleSiteSelect = useCallback((selectedOptions) => {
        setSelectedSites(selectedOptions.map(option => option.value))
    }, [])

    const handleOnlyLabeledChange = useCallback(() => {
        setLabeledOnly(!labeledOnly)
    }, [labeledOnly])

    const updateWindowWidth = useCallback(() => {
        setDensityPlotWidth(densityPlotRef.current.clientWidth);
    }, [])

    useEffect(() => {
        window.addEventListener("resize", updateWindowWidth)
        updateWindowWidth()
        return () => {
            window.removeEventListener("resize", updateWindowWidth)
        }
    }, [])

    const range = useMemo(() => {
        if (imageRange && audioRange) {
            return [Math.min(imageRange[0], audioRange[0]), Math.max(imageRange[1], audioRange[1])]
        } else if (imageRange) {
            return imageRange
        } else if (audioRange) {
            return audioRange
        } else {
            return undefined
        }
    }, [imageRange, audioRange])

    const start = scrollLeft / scale + (range ? range[0] : 0)
    const end = (scrollLeft + (timelineRef.current ? timelineRef.current.getBoundingClientRect().width : window.innerWidth)) / scale + (range ? range[0] : 0)

    const nextStartOnceRangeLoadedRef = useRef(null)
    const loadStateFromHash = useCallback(() => {
        try {
            const [nextStart, nextEnd, nextPlaybackIndicatorPosition] = window.location.hash.substring(1).split("-").slice(1).map(e => parseInt(e, 10) * 1000 / timeFactor)
            setSelectedSites(window.location.hash.substring(1).split("-")[0].split(","))
            
            const nextScale = timelineRef.current.getBoundingClientRect().width / (nextEnd - nextStart)
            scaleRef.current = nextScale
            setScale(nextScale)
            nextStartOnceRangeLoadedRef.current = nextStart
            const nextScrollLeft = (nextStart - (range ? range[0] : 0)) * nextScale
            setScrollLeft(nextScrollLeft)
            timelineRef.current.scrollLeft = nextScrollLeft
            setPlaybackIndicatorPosition(nextPlaybackIndicatorPosition)
        } catch(error) {
            console.warn("Error while loading location hash:", error)
        }
    }, [timelineRef, range, nextStartOnceRangeLoadedRef])

    useEffect(() => {
        if (nextStartOnceRangeLoadedRef.current != null) {
            const nextScrollLeft = (nextStartOnceRangeLoadedRef.current - (range ? range[0] : 0)) * scaleRef.current
            setScrollLeft(nextScrollLeft)
            timelineRef.current.scrollLeft = nextScrollLeft
            nextStartOnceRangeLoadedRef.current = null
        }
    }, [nextStartOnceRangeLoadedRef, scaleRef, range])

    useEffect(() => {
        if (window.location.hash.length > 1) {
            loadStateFromHash()
        }
    }, [])

    const updateHash = useDebouncedCallback((nextHash) => {
        if (nextStartOnceRangeLoadedRef.current != null || selectedSites.length == 0 || start <= 0) {
            return
        }
        targetHashRef.current = nextHash
        try {
            window.location.hash = nextHash
        } catch (error) {
            console.warn("Error while setting location hash:", error)
        }
    }, 100, { maxWait: 1000 })

    useEffect(() => {
       updateHash(`${selectedSites.join(",")}-${Math.round(timeFactor * start / 1000)}-${Math.round(timeFactor * end / 1000)}-${Math.round(timeFactor * playbackIndicatorPosition / 1000)}`)
    }, [updateHash, selectedSites, start, end, playbackIndicatorPosition])

    useEffect(() => {
        window.addEventListener("hashchange", () => {
            if (window.location.hash.substring(1) != targetHashRef.current) {
                loadStateFromHash()
            }
        })
    }, [targetHashRef, loadStateFromHash])

    const activeImageSample = imageSamples ? imageSamples[activeImageSampleIdx] : undefined
    const activeAudioSample = audioSamples ? audioSamples[activeAudioSampleIdx] : undefined

    const handleTimelineClick = useCallback((evt) => {
        if (evt.button != 0) return
        if ((evt.clientY - timelineRef.current.getBoundingClientRect().top) < 100) return  // TODO: implement more robust way to only handle clicks in on audio tracks
        const nextPlaybackIndicatorPosition = range[0] + (evt.clientX - timelineInnerRef.current.getBoundingClientRect().left) / scale
        setPlaybackIndicatorPosition(nextPlaybackIndicatorPosition)
        if (playing) {
            const res = audioSamplesTree.search([nextPlaybackIndicatorPosition, nextPlaybackIndicatorPosition])
            if (res.includes(activeAudioSampleIdx)) {
                audioRef.current.currentTime = timelineToAudioTime(nextPlaybackIndicatorPosition, activeAudioSample.start)
            } else if (res.length >= 1) {
                console.log(`Warning: Ambiguous number of audio samples (${res.length}), picking an arbitrary one to play...`)
                setActiveAudioSampleIdx(res[0])
            } else {
                setActiveAudioSampleIdx(0)
                audioRef.current.pause()
                setPlaying(false)
            }
        }
    }, [timelineInnerRef, scale, range, playing, audioRef, activeAudioSample, activeAudioSampleIdx, setPlaying])

    const handlePlayButtonClick = useCallback(() => {
        setPlaying(!playing)
        if (!playing) {
            const res = audioSamplesTree.search([playbackIndicatorPosition, playbackIndicatorPosition])
            if (res.length === 0) {
                console.log(`Warning: No audio samples at selected position.`)
            } else if (res.length !== 1) {
                // TODO: handle this case better
                console.log(`Warning: Ambiguous number of audio samples (${res.length}), picking an arbitrary one to play...`)
            }
            setActiveAudioSampleIdx(res[0])
            audioRef.current && audioRef.current.play()
        } else {
            if (audioRef.current) {
                audioRef.current.pause()
            }
        }
    }, [playing, playbackIndicatorPosition, range, audioSamplesTree, audioRef])

    const handleAudioTimeUpdate = useCallback((evt) => {
        setPlaybackIndicatorPosition(audioToTimelineTime(evt.target.currentTime, activeAudioSample.start))
    }, [activeAudioSample])

    const handleAudioPlayStart = useCallback((evt) => {
        evt.target.currentTime = timelineToAudioTime(playbackIndicatorPosition, activeAudioSample.start)
    }, [playbackIndicatorPosition, activeAudioSample])

    const handleAudioPlayEnd = useCallback(() => {
        const endPos = Math.max(activeAudioSample.end, playbackIndicatorPosition) + 10 * timelineUnitSecond
        const res = audioSamplesTree.search([endPos, endPos])
        if (res.length >= 1) {
            if (res.length !== 1) {
                // TODO: handle this case better
                console.log(`Warning: Ambiguous number of audio samples (${res.length}), picking an arbitrary one to play...`)
            }
            setActiveAudioSampleIdx(res[0])
        }
    }, [activeAudioSample])

    const enablePlayButton = useMemo(() => (
        playbackIndicatorPosition && audioSamplesTree && audioSamplesTree.search([playbackIndicatorPosition, playbackIndicatorPosition]).length > 0
    ), [audioSamplesTree, playbackIndicatorPosition])

    return (
        <div className="App">
            <h2>Locations:</h2>
            <div className="site-selector">
                <div className="site-selector__select"><Select options={availableSites.map(site => ({ value: site, label: site }))} onChange={handleSiteSelect} isMulti value={selectedSites.map(site => ({ value: site, label: site }))} /></div>
                <div><label>Show labeled only: <input type="checkbox" value={labeledOnly} onChange={handleOnlyLabeledChange} name="only-labeled-checkbox" /></label></div>
            </div>
            <div className="row">
                <h2>Time range: {range ? (dtFormat.format(new Date(start * timeFactor)) + " - " + dtFormat.format(new Date(end * timeFactor))) : "none"}</h2>
                <button className="timeline__play-button" disabled={!enablePlayButton} onClick={handlePlayButtonClick}>{playing ? "Pause" : "Play"}</button>
                {activeAudioSample && (
                    <audio
                        className="timeline__audio"
                        key={activeAudioSampleIdx}
                        preload="auto"
                        controls
                        ref={audioRef}
                        autoPlay={playing}
                        src={activeAudioSample.audioUrl}
                        onTimeUpdate={handleAudioTimeUpdate}
                        onPlay={handleAudioPlayStart}
                        onEnded={handleAudioPlayEnd} />
                )}
            </div>
            <div className="timeline" onScroll={handleScroll} ref={timelineRef}>
                <div className="timeline__outer" style={{width: range ? scale * (range[1] - range[0]) : "100%"}}>
                    <div className="timeline__inner" style={{width: range ? range[1] - range[0] : "100%", transform: `scaleX(${scale})`}} ref={timelineInnerRef} onMouseDown={handleTimelineClick}>
                        {range && imageSamplesTree && imageSamplesTree.search([start - lookupMarginLeft, end + lookupMarginRight], (i, interval) => (
                            <div key={i} onClick={handleImageSampleClick} data-sample-idx={i} className="image-sample" style={{
                                left: interval.low - range[0],
                                transform: `scaleX(${1/scale})`,
                                backgroundImage: `url(${imageSamples[i].backgroundImageUrl})`,
                            }}></div>
                        )).slice(0, nMaxSamples)}
                        {range && audioSamplesTree && audioSamplesTree.search([start - lookupMarginLeft, end + lookupMarginRight], (i, interval) => (
                            <div key={i} data-sample-idx={i} className="audio-sample" style={{
                                left: interval.low - range[0],
                                width: interval.high - interval.low,
                                backgroundImage: `url(${audioSamples[i].backgroundImageUrl})`,
                            }}></div>
                        )).slice(0, nMaxSamples)}
                        {(playbackIndicatorPosition && range) ? <div className="timeline__playback-indicator" style={{ transform: `translateX(${playbackIndicatorPosition - range[0]}px) scaleX(${1/scale})` }} /> : undefined}
                    </div>
                </div>
            </div>
            <div className="density-plot" ref={densityPlotRef}>
                <Plot
                    data={[
                        {
                            x: imageDensityX,
                            y: imageDensityY,
                            type: 'histogram',
                            marker: {color: '#ffb300'},
                        },
                        {
                            x: audioDensityX,
                            y: audioDensityY,
                            type: 'histogram',
                            marker: {color: 'purple'},
                        },
                    ]}
                    layout={{autosize: true, showlegend: false, width: densityPlotWidth, height: 200, padding: 0, margin: 0, yaxis: {type: 'log', autorange: true}, margin: {
                        l: 0,
                        r: 0,
                        b: 0,
                        t: 0,
                        pad: 5
                      }}}
                    config={{staticPlot: true, responsive: true}}
                />
                {range ? <div className="density-plot__overlay" style={{ width: (100 * (end - start) / (range[1] - range[0])) + "%", left: ((100) * ((start - range[0]) / (range[1] - range[0]))) + "%" }}></div> : undefined}
                {range ? <span className="density-plot__rangestart">{dtFormatShort.format(new Date(range[0] * timeFactor))}</span> : undefined}
                {range ? <span className="density-plot__rangeend">{dtFormatShort.format(new Date(range[1] * timeFactor))}</span> : undefined}
            </div>
            <div className="map">
                <Map
                    initialViewState={{
                        latitude: 0.25,
                        longitude: 37.304266,
                        zoom: 9,
                    }}
                    style={{position: "absolute", width: "100%", height: "100%"}}
                    // mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
                    mapStyle="https://api.maptiler.com/maps/hybrid/style.json?key=eiff1QAsHRhozljtf7Yq"
                >
                    {range && audioSamplesTree && audioSamplesTree.search([start - lookupMarginLeft, end + lookupMarginRight], (i, interval) => (
                        <Marker key={"audio-" + i} longitude={audioSamples[i].longitude} latitude={audioSamples[i].latitude} color="purple" />
                    ))}
                    {range && imageSamplesTree && imageSamplesTree.search([start - lookupMarginLeft, end + lookupMarginRight], (i, interval) => (
                        <Marker key={"image-" + i} longitude={imageSamples[i].longitude} latitude={imageSamples[i].latitude} color="#ffb300" />
                    ))}
                    <ScaleControl />
                </Map>
            </div>
            <Modal
                isOpen={showImageSampleModal}
                onRequestClose={handleImageSampleModalClose}
            >
                {activeImageSample && <div className="image-modal-content"><img src={getImageUrl(activeImageSample)} /></div>}
            </Modal>
            <Modal
                isOpen={showAudioSampleModal}
                onRequestClose={handleAudioSampleModalClose}
            >
                {activeAudioSample && <AudioPlayer sample={activeAudioSample} />}
            </Modal>
        </div>
    );
}

export default App;