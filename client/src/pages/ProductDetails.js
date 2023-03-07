
import React, { useState, useEffect } from "react";
import Layout from "./../components/Layout/Layout";
import axios from "axios";
import { useParams, useNavigate } from "react-router-dom";
import './HomeStyle.css'
import toast from "react-hot-toast";
import { useCart } from "../context/cart";
const ProductDetails = () => {
  const params = useParams();
  const navigate = useNavigate();
  const [product, setProduct] = useState({});
  const [cart, setCart] = useCart();
  const [relatedProducts, setRelatedProducts] = useState([]);

  //initalp details
  useEffect(() => {
    if (params?.slug) getProduct();
  }, [params?.slug]);
  //getProduct
  const getProduct = async () => {
    try {
      const { data } = await axios.get(
        `/api/v1/product/get-product/${params.slug}`
      );
      setProduct(data?.product);
      getSimilarProduct(data?.product._id, data?.product.category._id);
    } catch (error) {
      console.log(error);
    }
  };
  //get similar product
  const getSimilarProduct = async (pid, cid) => {
    try {
      const { data } = await axios.get(
        `/api/v1/product/related-product/${pid}/${cid}`
      );
      setRelatedProducts(data?.products);
    } catch (error) {
      console.log(error);
    }
  };


  const setCartItem = (p) => {
    if (cart.some(item => item._id === p._id)) {
      toast.error("You have already added this Item");
      return;
    } else {
      setCart([...cart, p]);
      localStorage.setItem(
        "cart",
        JSON.stringify([...cart, p])
      );
      toast.success("Item Added to cart");
    }
  }

  return (
    <Layout>
      <div className="container productDetails">
        <div className="row">
          <div className="col-md-6">
            <img
              src={`/api/v1/product/product-photo/${product._id}`}
              className="card-img-top"
              alt={product.name}
              height="500"
              width={"300px"}
            />
          </div>
          <div className="col-md-6 ">
            <h2 className="">Product <span className="text-dark">Details</span></h2>
            <h4>Name : {product.name}</h4>
            <h6>Description : {product.description}</h6>
            <h6 className="fw-bold">Price : ${product.price}</h6>
            <h6>Category : {product?.category?.name}</h6>
            <button
              className="button-2 ms-1"
              onClick={() => setCartItem(product)}
            >
              Add To Cart
            </button>
          </div>
        </div>

        <hr />
        <div className="row container">
          <h4>Similar Products</h4>
          {relatedProducts.length < 1 && (
            <p className="text-center">No Similar Products found</p>
          )}
          <div className="d-flex flex-wrap">
            {relatedProducts?.map((p) => (
                <div className="card m-3 mb-5" style={{ width: "18rem" }} key={p._id}>
                  <img
                    src={`/api/v1/product/product-photo/${p._id}`}
                    className="card-img-top"
                    alt={p.name}
                  />
                  <div className="card-body">
                    <h5>{p.name}</h5>
                    <p> {p.description.substring(0, 30)}...</p>
                    <h4> ${p.price}</h4>
                    <button
                      className=" button-1 ms-1"
                      onClick={() => navigate(`/product/${p.slug}`)}
                    >
                      More Details
                    </button>
                    <button
                      className=" button-2 ms-1"
                      onClick={() => setCartItem(p)}
                    >
                      Add To Cart
                    </button>
                  </div>
                </div>
            ))}
          </div>
        </div>
      </div>


    </Layout>
  );
};

export default ProductDetails;