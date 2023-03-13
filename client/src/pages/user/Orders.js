
import React, { useState, useEffect } from "react";
import UserMenu from "../../components/Layout/UserMenu";
import Layout from "./../../components/Layout/Layout";
import axios from "axios";
import { useAuth } from "../../context/auth";
import moment from "moment";

const Orders = () => {
  const [orders, setOrders] = useState([]);
  const [auth, setAuth] = useAuth();
  
  const getOrders = async () => {
    try {
      const { data } = await axios.get("/api/v1/auth/orders");
      setOrders(data);
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    if (auth?.token) getOrders();
  }, [auth?.token]);
  
  return (
    <Layout title={"Your Orders"}>
      <div className="userDashboard">
        <div className="container">
          <div className="row">
            <div className="col-md-3 p-0 m-0">
              <UserMenu />
            </div>
            <div className="col-md-9">
              {orders?.map((o, i) => {
                return (
                  <div className="border shadow">
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">#</th>
                          <th scope="col">Status</th>
                          <th scope="col">Buyer</th>
                          <th scope="col"> date</th>
                          <th scope="col">Payment</th>
                          <th scope="col">Quantity</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{i + 1}</td>
                          <td className="brown fw-bold">{o?.status}</td>
                          <td>{o?.buyer?.name}</td>
                          <td>{moment(o?.createAt).fromNow()}</td>
                          <td className={o?.payment.success ? "text-success fw-bold": "text-danger"}>{o?.payment.success ? "Success" : "Failed"}</td>
                          <td className="fw-bold">{o?.products?.length}</td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="container">

                      <div className="row mb-2 p-3  flex-row">
                        <table class="table">
                          <thead>
                            <tr>
                              <th>Image</th>
                              <th>Name</th>
                              <th>Price</th>
                            </tr>
                          </thead>
                          <tbody>
                            {o?.products?.map((p) => (
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
                              </tr>
                            ))}

                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Orders;