
import React, { useState, useEffect } from "react";
import axios from "axios";
import toast from "react-hot-toast";
import AdminMenu from "../../components/Layout/AdminMenu";
import Layout from "../../components/Layout/Layout";
import { useAuth } from "../../context/auth";
import moment from "moment";
import { Select } from "antd";
const { Option } = Select;

const AdminOrders = () => {
  const [status, setStatus] = useState([
    "Not Process",
    "Processing",
    "Shipped",
    "deliverd",
    "cancel",
  ]);
  const [changeStatus, setCHangeStatus] = useState("");
  const [orders, setOrders] = useState([]);
  const [auth, setAuth] = useAuth();
  const getOrders = async () => {
    try {
      const { data } = await axios.get("/api/v1/auth/all-orders");
      setOrders(data);
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    if (auth?.token) getOrders();
  }, [auth?.token]);

  const handleChange = async (orderId, value) => {
    try {
      const { data } = await axios.put(`/api/v1/auth/order-status/${orderId}`, {
        status: value,
      });
      getOrders();
    } catch (error) {
      console.log(error);
    }
  };
  return (
    <Layout title={"All Orders Data"}>
      <div className="adminDashboard">
        <div className="container">
          <div className="row">
            <div className="col-md-3 p-0 m-0">
              <AdminMenu />
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
                          <td className="brown fw-bold" >
                            <Select
                              bordered={false}
                              onChange={(value) => handleChange(o._id, value)}
                              defaultValue={o?.status}
                              
                            >
                              {status.map((s, i) => (
                                <Option className="brown fw-bold" key={i} value={s}>
                                  {s}
                                </Option>
                              ))}
                            </Select>
                          </td>
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

export default AdminOrders;