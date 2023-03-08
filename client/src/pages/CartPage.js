
import React, { useState, useEffect } from "react";
import Layout from "./../components/Layout/Layout";
import { useCart } from "../context/cart";
import { useAuth } from "../context/auth";
import { useNavigate } from "react-router-dom";
import DropIn from "braintree-web-drop-in-react";
import axios from "axios";
import toast from "react-hot-toast";

const CartPage = () => {
  const [auth, setAuth] = useAuth();
  const [cart, setCart] = useCart();
  const [clientToken, setClientToken] = useState("");
  const [instance, setInstance] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  //total price
  const totalPrice = () => {
    try {
      let total = 0;
      cart?.map((item) => {
        total += item.amount * item.price;
      });
      return total.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      });
    } catch (error) {
      console.log(error);
    }
  };
  //detele item
  const removeCartItem = (pid) => {
    try {
      let myCart = [...cart];
      let index = myCart.findIndex((item) => item._id === pid);
      myCart.splice(index, 1);
      setCart(myCart);
      localStorage.setItem("cart", JSON.stringify(myCart));
    } catch (error) {
      console.log(error);
    }
  };

  // quantity increment 
  const handleQuantity = (item, d) => {
    const ind = cart.indexOf(item);
    const arr = cart;
    arr[ind].amount += d;
    if (arr[ind].amount === 0) arr[ind].amount = 1;
    setCart([...arr]);
    localStorage.setItem("cart", JSON.stringify(arr));
  }

  //get payment gateway token
  const getToken = async () => {
    try {
      const { data } = await axios.get("/api/v1/product/braintree/token");
      setClientToken(data?.clientToken);
    } catch (error) {
      console.log(error);
    }
  };
  useEffect(() => {
    getToken();
  }, [auth?.token]);

  //handle payments
  const handlePayment = async () => {
    try {
      setLoading(true);
      const { nonce } = await instance.requestPaymentMethod();
      const { data } = await axios.post("/api/v1/product/braintree/payment", {
        nonce,
        cart,
      });
      setLoading(false);
      localStorage.removeItem("cart");
      setCart([]);
      navigate("/dashboard/user/orders");
      toast.success("Payment Completed Successfully ");
    } catch (error) {
      console.log(error);
      setLoading(false);
    }
  };



  return (
    <Layout>
      <div className="container cart">
        <div className="row">
          <div className="col-md-12">
            <h4 className="fw-bold mb-1 mt-2">
              {`Hello, ${auth?.token && auth?.user?.name}`}
            </h4>
            <h6 className="mb-5 brown">
              {cart?.length
                ? `You Have  ${cart.length} items in your cart ${auth?.token ? "" : "please login to checkout"
                }`
                : " Your Cart Is Empty"}
            </h6>
          </div>
        </div>
        <div className="row">
          <div className="col-md-7">
            <table class="table">
              <thead>
                <tr>
                  <th>Image</th>
                  <th>Name</th>
                  <th>Price</th>
                  <th>Quantity</th>
                  <th>Remove</th>
                </tr>
              </thead>
              <tbody>
                {cart?.map((p) => (
                  <tr className="shadow p-2 mb-2 bg-body-tertiary rounded">
                    <td>
                      <img
                        src={`/api/v1/product/product-photo/${p._id}`}
                        alt={p.name}
                        width={"60px"}
                        height={"60px"}
                      /></td>
                    <td ><p className="fw-bold pt-2"> {p.name} </p></td>
                    <td><p className="brown fw-bold pt-2"> ${p.price} </p></td>
                    <td>
                      <div className="d-flex">
                        <h6 className="btn btn-outline-warning mx-2 rounded-circle fw-bold" onClick={() => handleQuantity(p, -1)} >-</h6>
                        <h6 className="btn btn-outline-info rounded-circle fw-bold ">{p.amount}</h6>
                        <h6 className="btn btn-outline-warning mx-2 rounded-circle fw-bold" onClick={() => handleQuantity(p, +1)} >+</h6>

                      </div>
                    </td>
                    <td>
                      <h6
                        className="btn btn-outline-danger rounded-circle fw-bold"
                        onClick={() => removeCartItem(p._id)}
                      >
                        X
                      </h6>
                    </td>
                  </tr>
                ))}

              </tbody>
            </table>



            {/* {cart?.map((p) => (
              <div className="row mb-2 p-3 card flex-row">
                <div className="col-md-4">
                  <img
                    src={`/api/v1/product/product-photo/${p._id}`}
                    className="card-img-top"
                    alt={p.name}
                    width="100px"
                    height={"100px"}
                  />
                </div>
                <div className="col-md-6">
                  <p>{p.name}</p>
                  <p>{p.description.substring(0, 30)}</p>
                  <p>Price : {p.price}</p>
                  <button
                    className="btn btn-danger"
                    onClick={() => removeCartItem(p._id)}
                  >
                    Remove
                  </button>
                </div>
                <div className="col-md-2">
                  <div className="d-flex">
                    <button className="btn btn-outline-warning mx-2" onClick={() => handleQuantity(p, -1)} >-</button>
                    <h6>{p.amount}</h6>
                    <button className="btn btn-outline-warning mx-2" onClick={() => handleQuantity(p, +1)} >+</button>
                  </div>
                </div>
              </div>
            ))} */}
          </div>
          <div className="col-md-1"></div>
          <div className="col-md-4  shadow pt-4 p-4">
            <h3 className="fw-bold text-center">Cart Summary</h3>
            <p className="text-center fw-bold">Total | Checkout | Payment</p>
            <hr />
            <h4 className="fw-bold brown text-center mb-4 mt-4">Total : {totalPrice()} </h4>
            {auth?.user?.address ? (
              <>
                <div className="mb-3 mt-3">
                  <h6><span className="brown">Current Address:</span> {auth?.user?.address}  </h6>
                  <button
                    className="btn btn-outline-dark mt-2 fw-bold"
                    onClick={() => navigate("/dashboard/user/profile")}
                  >
                    Update Address
                  </button>
                </div>
              </>
            ) : (
              <div className="mb-3">
                {auth?.token ? (
                  <button
                    className="btn btn-outline-warning"
                    onClick={() => navigate("/dashboard/user/profile")}
                  >
                    Update Address
                  </button>
                ) : (
                  <button
                    className="btn btn-outline-warning"
                    onClick={() =>
                      navigate("/login", {
                        state: "/cart",
                      })
                    }
                  >
                    Plase Login to checkout
                  </button>
                )}
              </div>
            )}
            <div className="mt-2 paymentArea">
              {!clientToken || !cart?.length ? (
                ""
              ) : (
                <>
                  <DropIn
                    options={{
                      authorization: clientToken,
                      paypal: {
                        flow: "vault",
                      },
                    }}
                    onInstance={(instance) => setInstance(instance)}
                  />

                  <button
                    className="button-1"
                    onClick={handlePayment}
                    disabled={loading || !instance || !auth?.user?.address}
                  >
                    {loading ? "Processing ...." : "Make Payment"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default CartPage;