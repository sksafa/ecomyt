import React from 'react'
import slider1 from '../Image/Slider-1.jpg'
import slider2 from '../Image/Slider-2.jpg'
import slider3 from '../Image/Slider-3.jpg'

const Banner = () => {
    return (
        <div id="carouselExampleFade" className="carousel slide carousel-fade customSlider" data-bs-ride="carousel">
            <div className="carousel-inner">
                <div className="carousel-item active">
                    <img src={slider3} className="d-block w-100" alt="..." />
                    <div className="carousel-caption">
                        <h1>New Range Of  <br /><span className="titleText">Canon Camera</span></h1>
                        <button className="btn btn-warning">Shop Now</button>
                    </div>
                </div>
                <div className="carousel-item">
                    <img src={slider2} className="d-block w-100" alt="..." />
                    <div className="carousel-caption">
                        <h1>New Range Of Smart<br /><span className="titleText">Gaming Mouse</span></h1>
                        <button className="btn btn-warning">Shop Now</button>
                    </div>
                </div>
                <div className="carousel-item">
                    <img src={slider1} className="d-block w-100" alt="..." />
                    <div className="carousel-caption">
                        <h1>New Range Of <br /><span className="titleText">Samsung Oven</span></h1>
                        <button className="btn btn-warning">Shop Now</button>
                    </div>
                </div>
            </div>

            <button className="carousel-control-prev" type="button" data-bs-target="#carouselExampleFade" data-bs-slide="prev">
                <span className="carousel-control-prev-icon" aria-hidden="true"></span>
                <span className="visually-hidden">Previous</span>
            </button>
            <button className="carousel-control-next" type="button" data-bs-target="#carouselExampleFade" data-bs-slide="next">
                <span className="carousel-control-next-icon" aria-hidden="true"></span>
                <span className="visually-hidden">Next</span>
            </button>
        </div>
    )
}

export default Banner